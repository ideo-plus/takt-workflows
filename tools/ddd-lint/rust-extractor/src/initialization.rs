//! The direct constructions protected by an input rejection guard, and of's checked parse wrapper.
use serde_json::{json, Value};
use std::collections::HashSet;
use syn::{
    spanned::Spanned,
    visit::{self, Visit},
};

struct Names<'a>(&'a HashSet<String>, bool);
impl<'ast> Visit<'ast> for Names<'_> {
    fn visit_expr_path(&mut self, node: &'ast syn::ExprPath) {
        if node.path.segments.len() == 1
            && self.0.contains(&node.path.segments[0].ident.to_string())
        {
            self.1 = true;
        }
        visit::visit_expr_path(self, node);
    }
}

fn input_names(method: &syn::ImplItemFn) -> HashSet<String> {
    let mut names: HashSet<String> = method
        .sig
        .inputs
        .iter()
        .filter_map(|parameter| match parameter {
            syn::FnArg::Typed(parameter) => match &*parameter.pat {
                syn::Pat::Ident(name) => Some(name.ident.to_string()),
                _ => None,
            },
            _ => None,
        })
        .collect();
    for statement in &method.block.stmts {
        if let syn::Stmt::Local(local) = statement {
            if let (syn::Pat::Ident(name), Some(initializer)) = (&local.pat, &local.init) {
                let mut used = Names(&names, false);
                used.visit_expr(&initializer.expr);
                if used.1 {
                    names.insert(name.ident.to_string());
                }
            }
        }
    }
    names
}

fn expression(statement: &syn::Stmt) -> Option<&syn::Expr> {
    match statement {
        syn::Stmt::Expr(value, _) => Some(value),
        _ => None,
    }
}

fn returns_error(block: &syn::Block) -> bool {
    if block.stmts.len() != 1 {
        return false;
    }
    match expression(&block.stmts[0]) {
        Some(syn::Expr::Return(returned)) => match returned.expr.as_deref() {
            Some(syn::Expr::Call(call)) => {
                matches!(&*call.func, syn::Expr::Path(path) if path.path.is_ident("Err"))
            }
            _ => false,
        },
        _ => false,
    }
}

struct Creations {
    guarded: bool,
    input: Option<String>,
    entries: Vec<Value>,
}
fn creation_span(span: proc_macro2::Span) -> Value {
    let (start, end) = (span.start(), span.end());
    json!({"start_line":start.line,"start_col":start.column+1,"end_line":end.line,"end_col":end.column+1})
}
fn same_input(expression: &syn::Expr, input: Option<&str>) -> bool {
    match expression {
        syn::Expr::Path(path) => input.is_some_and(|name| path.path.is_ident(name)),
        syn::Expr::MethodCall(call) => {
            matches!(
                call.method.to_string().as_str(),
                "to_string" | "to_owned" | "clone"
            ) && call.args.is_empty()
                && same_input(&call.receiver, input)
        }
        _ => false,
    }
}
impl<'ast> Visit<'ast> for Creations {
    fn visit_expr_call(&mut self, node: &'ast syn::ExprCall) {
        if let syn::Expr::Path(path) = &*node.func {
            if path.path.segments.len() == 1 {
                let name = path.path.segments[0].ident.to_string();
                if name == "Self" || name.chars().next().is_some_and(char::is_uppercase) {
                    let same =
                        node.args.len() == 1 && same_input(&node.args[0], self.input.as_deref());
                    self.entries.push(json!({"type_text":name,"guarded":self.guarded && same,"line":node.span().start().line,"span":creation_span(node.span())}));
                }
            }
        }
        visit::visit_expr_call(self, node);
    }
    fn visit_expr_struct(&mut self, node: &'ast syn::ExprStruct) {
        let name = node
            .path
            .segments
            .iter()
            .map(|part| part.ident.to_string())
            .collect::<Vec<_>>()
            .join("::");
        let same = node.fields.len() == 1
            && same_input(&node.fields[0].expr, self.input.as_deref())
            && node.rest.is_none();
        self.entries.push(json!({"type_text":name,"guarded":self.guarded && same,"line":node.span().start().line,"span":creation_span(node.span())}));
        visit::visit_expr_struct(self, node);
    }
    fn visit_expr_closure(&mut self, _: &'ast syn::ExprClosure) {}
    fn visit_item_fn(&mut self, _: &'ast syn::ItemFn) {}
}

pub fn facts(method: &syn::ImplItemFn) -> Value {
    let names = input_names(method);
    let input = if method.sig.inputs.len() == 1 {
        method
            .sig
            .inputs
            .first()
            .and_then(|parameter| match parameter {
                syn::FnArg::Typed(parameter) => match &*parameter.pat {
                    syn::Pat::Ident(name) if name.mutability.is_none() => {
                        Some(name.ident.to_string())
                    }
                    _ => None,
                },
                _ => None,
            })
    } else {
        None
    };
    let mut creations = Creations {
        guarded: false,
        input,
        entries: Vec::new(),
    };
    for statement in &method.block.stmts {
        if let syn::Stmt::Local(local) = statement {
            if let syn::Pat::Ident(name) = &local.pat {
                if creations.input.as_deref() == Some(name.ident.to_string().as_str()) {
                    creations.guarded = false;
                    creations.input = None;
                }
            }
        }
        creations.visit_stmt(statement);
        if let Some(syn::Expr::If(guard)) = expression(statement) {
            let mut used = Names(&names, false);
            used.visit_expr(&guard.cond);
            if guard.else_branch.is_none() && returns_error(&guard.then_branch) && used.1 {
                creations.guarded = true;
            }
        }
    }
    let mut delegate = None;
    if method.block.stmts.len() == 1 && method.sig.inputs.len() == 1 {
        let body = expression(&method.block.stmts[0]);
        let body = match body {
            Some(syn::Expr::Return(value)) => value.expr.as_deref(),
            other => other,
        };
        if let Some(syn::Expr::MethodCall(unwrapped)) = body {
            if matches!(unwrapped.method.to_string().as_str(), "expect" | "unwrap") {
                if let syn::Expr::Call(parsed) = &*unwrapped.receiver {
                    if let syn::Expr::Path(path) = &*parsed.func {
                        if path.path.segments.len() == 2
                            && path.path.segments[1].ident == "parse"
                            && parsed.args.len() == 1
                        {
                            if let (
                                Some(syn::FnArg::Typed(parameter)),
                                Some(syn::Expr::Path(argument)),
                            ) = (method.sig.inputs.first(), parsed.args.first())
                            {
                                if let syn::Pat::Ident(name) = &*parameter.pat {
                                    if argument.path.is_ident(&name.ident.to_string()) {
                                        delegate = Some(path.path.segments[0].ident.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    json!({"creations":creations.entries,"parse_delegate":delegate})
}
