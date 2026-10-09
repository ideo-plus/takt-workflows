//! Proof that a rejected-input path leaves a float unchanged by an integer cast.
//!
//! Only direct primitive parameters and literal bounds are understood. Unknown expressions do
//! not contribute evidence. Rejecting a disjunction proves each of its invalid cases absent;
//! rejecting a conjunction does not prove either case absent on its own.
use std::collections::HashSet;
use syn::{
    visit::{self, Visit},
    BinOp, Expr, FnArg, ImplItemFn, Lit, Type, UnOp,
};

/// A name may have been imported or redeclared rather than denoting a built-in primitive.
/// Unknown glob imports are conservative; test-only modules do not affect production bindings.
#[derive(Default, Clone)]
pub struct PrimitiveNames {
    blocked: HashSet<String>,
    wildcard: bool,
}
impl PrimitiveNames {
    pub fn for_file(file: &syn::File) -> Self {
        let mut names = Self::default();
        names.visit_file(file);
        names
    }
    fn builtin(&self, name: &str) -> bool {
        !self.wildcard && !self.blocked.contains(name)
    }
}
impl<'ast> Visit<'ast> for PrimitiveNames {
    fn visit_item_mod(&mut self, node: &'ast syn::ItemMod) {
        if node.attrs.iter().any(|attr| matches!(&attr.meta, syn::Meta::List(list) if list.path.is_ident("cfg") && list.tokens.to_string() == "test")) {
            return;
        }
        visit::visit_item_mod(self, node);
    }
    fn visit_item_type(&mut self, node: &'ast syn::ItemType) {
        self.blocked.insert(node.ident.to_string());
        visit::visit_item_type(self, node);
    }
    fn visit_item_struct(&mut self, node: &'ast syn::ItemStruct) {
        self.blocked.insert(node.ident.to_string());
        visit::visit_item_struct(self, node);
    }
    fn visit_item_enum(&mut self, node: &'ast syn::ItemEnum) {
        self.blocked.insert(node.ident.to_string());
        visit::visit_item_enum(self, node);
    }
    fn visit_item_union(&mut self, node: &'ast syn::ItemUnion) {
        self.blocked.insert(node.ident.to_string());
        visit::visit_item_union(self, node);
    }
    fn visit_type_param(&mut self, node: &'ast syn::TypeParam) {
        self.blocked.insert(node.ident.to_string());
        visit::visit_type_param(self, node);
    }
    fn visit_use_tree(&mut self, tree: &'ast syn::UseTree) {
        match tree {
            syn::UseTree::Name(name) => {
                self.blocked.insert(name.ident.to_string());
            }
            syn::UseTree::Rename(name) => {
                self.blocked.insert(name.rename.to_string());
            }
            syn::UseTree::Glob(_) => self.wildcard = true,
            _ => {}
        }
        visit::visit_use_tree(self, tree);
    }
}

#[derive(Clone, Copy)]
struct Bound {
    value: f64,
    exclusive: bool,
}

#[derive(Default, Clone)]
pub struct NumericCastProof {
    float_input: bool,
    names: PrimitiveNames,
    finite: bool,
    integral: bool,
    lower: Option<Bound>,
    upper: Option<Bound>,
}

fn unwrapped(mut expression: &Expr) -> &Expr {
    loop {
        expression = match expression {
            Expr::Paren(value) => &value.expr,
            Expr::Group(value) => &value.expr,
            _ => return expression,
        };
    }
}

fn parameter(expression: &Expr, input: &str) -> bool {
    matches!(unwrapped(expression), Expr::Path(value) if value.qself.is_none() && value.path.is_ident(input))
}

fn literal(expression: &Expr) -> Option<f64> {
    let value = match unwrapped(expression) {
        Expr::Lit(value) => match &value.lit {
            Lit::Float(value) if value.suffix().is_empty() || value.suffix() == "f64" => {
                value.base10_parse::<f64>().ok()?
            }
            _ => return None,
        },
        Expr::Unary(value) if matches!(value.op, UnOp::Neg(_)) => -literal(&value.expr)?,
        _ => return None,
    };
    value.is_finite().then_some(value)
}

fn method(expression: &Expr, input: &str, name: &str) -> bool {
    matches!(unwrapped(expression), Expr::MethodCall(value) if value.method == name && value.args.is_empty() && parameter(&value.receiver, input))
}

/// Integer ranges are half-open. Powers of two are exactly representable even when MAX is not.
fn integer_range(ty: &Type) -> Option<(f64, f64)> {
    let Type::Path(path) = ty else { return None };
    if path.qself.is_some() || path.path.segments.len() != 1 {
        return None;
    }
    let name = path.path.segments[0].ident.to_string();
    let (signed, width) = match name.as_str() {
        "u8" => (false, 8),
        "u16" => (false, 16),
        "u32" => (false, 32),
        "u64" => (false, 64),
        "u128" => (false, 128),
        "i8" => (true, 8),
        "i16" => (true, 16),
        "i32" => (true, 32),
        "i64" => (true, 64),
        "i128" => (true, 128),
        _ => return None,
    };
    let limit = 2.0_f64.powi(if signed { width - 1 } else { width });
    Some((if signed { -limit } else { 0.0 }, limit))
}

impl NumericCastProof {
    pub fn new(method: &ImplItemFn, names: &PrimitiveNames) -> Self {
        let float_input = names.builtin("f64")
            && method.sig.inputs.len() == 1
            && matches!(method.sig.inputs.first(), Some(FnArg::Typed(value)) if matches!(&*value.ty, Type::Path(path) if path.qself.is_none() && path.path.is_ident("f64")));
        Self {
            float_input,
            names: names.clone(),
            ..Self::default()
        }
    }

    /// Called only after a top-level guard whose sole consequence is returning Err.
    pub fn reject(&mut self, condition: &Expr, input: &str) {
        match unwrapped(condition) {
            Expr::Binary(value) if matches!(value.op, BinOp::Or(_)) => {
                self.reject(&value.left, input);
                self.reject(&value.right, input);
            }
            Expr::Unary(value) if matches!(value.op, UnOp::Not(_)) => {
                if method(&value.expr, input, "is_finite") {
                    self.finite = true;
                }
            }
            Expr::Binary(value) => {
                if matches!(value.op, BinOp::Ne(_))
                    && ((method(&value.left, input, "fract") && literal(&value.right) == Some(0.0))
                        || (method(&value.right, input, "fract")
                            && literal(&value.left) == Some(0.0)))
                {
                    self.integral = true;
                    return;
                }
                let (bound, reverse) = if parameter(&value.left, input) {
                    (literal(&value.right), false)
                } else if parameter(&value.right, input) {
                    (literal(&value.left), true)
                } else {
                    return;
                };
                let Some(bound) = bound else { return };
                match (&value.op, reverse) {
                    (BinOp::Lt(_), false) | (BinOp::Gt(_), true) => self.lower(bound, false),
                    (BinOp::Le(_), false) | (BinOp::Ge(_), true) => self.lower(bound, true),
                    (BinOp::Gt(_), false) | (BinOp::Lt(_), true) => self.upper(bound, false),
                    (BinOp::Ge(_), false) | (BinOp::Le(_), true) => self.upper(bound, true),
                    _ => {}
                }
            }
            _ => {}
        }
    }

    fn lower(&mut self, value: f64, exclusive: bool) {
        if self
            .lower
            .is_none_or(|old| value > old.value || (value == old.value && exclusive))
        {
            self.lower = Some(Bound { value, exclusive });
        }
    }

    fn upper(&mut self, value: f64, exclusive: bool) {
        if self
            .upper
            .is_none_or(|old| value < old.value || (value == old.value && exclusive))
        {
            self.upper = Some(Bound { value, exclusive });
        }
    }

    pub fn preserves(&self, expression: &Expr, input: &str) -> bool {
        let Expr::Cast(cast) = unwrapped(expression) else {
            return false;
        };
        if !self.float_input || !self.finite || !self.integral || !parameter(&cast.expr, input) {
            return false;
        }
        let (Some(lower), Some(upper), Some((minimum, end))) =
            (self.lower, self.upper, integer_range(&cast.ty))
        else {
            return false;
        };
        // Conservative at the lower boundary: a literal below MIN is not used as proof.
        let Type::Path(target) = &*cast.ty else {
            return false;
        };
        self.names
            .builtin(&target.path.segments[0].ident.to_string())
            && lower.value >= minimum
            && (upper.value < end || (upper.value == end && upper.exclusive))
    }
}
