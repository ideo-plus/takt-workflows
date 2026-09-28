#!/usr/bin/env python3
"""Generate the DDD child workflows from the installed TAKT builtins.

ddd-implement / ddd-remediation / ddd-review are copies of the builtin
development-implement-dynamic / development-remediation-dynamic / development-review
with the edits below, for both en/ and ja/:

- ddd-implement, ddd-remediation: the dynamic facet pool is removed, so the conflicting
  builtin backend knowledge cannot be injected.
- ddd-review: the backend and CQRS+ES reviewers are removed and steps/ddd-reviewer.yaml
  is added as a fixed reviewer.
- all three: a section map declares every facet a builtin parent passes in (TAKT's trust
  boundary), with one-line `{extends:<builtin>}` reference files for builtin facets.
- ddd-implement (implement, reimplement), ddd-remediation (fix, fix-retry): a ddd-lint command
  quality gate that runs on the success transition only; every other transition skips it.

Re-run after upgrading TAKT:  python3 scripts/gen-ddd-workflows.py [--builtins DIR]
"""
import os, re, shutil, json, sys

def find_builtins():
    if "--builtins" in sys.argv:
        return sys.argv[sys.argv.index("--builtins") + 1]
    exe = shutil.which("takt")
    if not exe:
        sys.exit("takt is not on PATH; pass --builtins <takt package>/builtins")
    d = os.path.dirname(os.path.realpath(exe))
    while d != os.path.dirname(d):
        for cand in (d, os.path.join(d, "takt"), os.path.join(d, "node_modules", "takt")):
            pkg = os.path.join(cand, "package.json")
            if os.path.exists(pkg):
                try:
                    if json.load(open(pkg)).get("name") == "takt":
                        return os.path.join(os.path.realpath(cand), "builtins")
                except ValueError:
                    pass
        d = os.path.dirname(d)
    sys.exit("could not locate the takt package; pass --builtins <takt package>/builtins")

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
BUILTIN = find_builtins()
DDD_POL=["ddd-domain-model","ddd-domain-layer","ddd-use-case-layer","ddd-interface-adapter-layer","ddd-layer-dependency","ddd-domain-packaging","ddd-module-layout","ddd-rust","ddd-typescript"]
DDD_KNOW=["ddd-modeling","ddd-rust","ddd-typescript"]
REVIEW_INSTR=[p+n for n in ["architecture-review","security-review","testing-review","coding-review","frontend-review","cqrs-es-review"] for p in ("","follow-up-")]+["initial-ai-antipattern-review","follow-up-ai-antipattern-review"]
T={
 "en":{
  "map_comment":"""# Facet arguments passed from a builtin parent workflow into this project workflow are rejected by
# TAKT's trust boundary unless they are declared by name in this section map. Bundle facets point at
# real files; builtin facets point at one-line `{extends:<builtin name>}` reference files.
""",
  "impl_desc":'"Copy of the builtin development-implement-dynamic for the DDD workflows. The dynamic facet pool is removed so that no builtin knowledge that conflicts with the DDD conventions (backend) is injected; DDD facets arrive as fixed arguments."',
  "rem_desc":'"Copy of the builtin development-remediation-dynamic for the DDD workflows. The dynamic facet pool is removed from fix and fix-retry for the same reason as ddd-implement."',
  "rev_desc":'"Copy of the builtin development-review for the DDD workflows. The backend and CQRS+ES reviewers, whose rules conflict with the DDD conventions, are removed, and an always-run DDD reviewer is added."',
  "pool_comment":"# The dynamic facet pool is not used; it is declared only because the parent passes implementation_pool.\n",
 },
 "ja":{
  "map_comment":"""# builtin の親ワークフローからこの project workflow へ渡される facet 引数は、TAKT の信頼境界により、
# この section map に名前で宣言されていなければ拒否される。バンドル固有の facet は実ファイルを、
# builtin の facet は `{extends:<builtin名>}` だけの参照ファイルを指す。
""",
  "impl_desc":'"DDD ワークフロー用の builtin development-implement-dynamic のコピー。DDD 規約と衝突する builtin knowledge（backend）が注入されないよう動的 facet プールを外し、DDD の facet は固定の引数で受け取る。"',
  "rem_desc":'"DDD ワークフロー用の builtin development-remediation-dynamic のコピー。ddd-implement と同じ理由で fix と fix-retry の動的 facet プールを外している。"',
  "rev_desc":'"DDD ワークフロー用の builtin development-review のコピー。DDD 規約と衝突する backend と CQRS+ES のレビュアーを外し、常に実行する DDD レビュアーを加えている。"',
  "pool_comment":"# 動的 facet プールは使わない。親が implementation_pool を渡すため宣言だけ残している。\n",
 }}
LINT="bun .takt/tools/ddd-lint/ddd-lint.ts --project ."
def gate_block(lang):
    text={"en":f"Running `{LINT}` reports no findings; when the ddd-lint gate fails, read the output log it names and fix every finding",
          "ja":f"`{LINT}` の実行で指摘がない。ddd-lint のゲートが失敗したら、示された出力ログを読み、すべての指摘を直す"}[lang]
    return (f"    quality_gates:\n      - \"{text}\"\n      - type: command\n        name: ddd-lint\n"
            f"        command: \"{LINT}\"\n        cwd: \".\"\n        timeout_ms: 300000\n")
def add_gates(s, lang, steps, success):
    """Adds the ddd-lint gate to `steps`; rules whose target is not `success` skip it."""
    for name in steps:
        start=s.index(f"\n  - name: {name}\n")+1
        nxt=s.find("\n  - name: ",start)
        end=len(s) if nxt<0 else nxt+1
        block=s[start:end]
        block=block.replace("\n    rules:\n","\n"+gate_block(lang)+"    rules:\n",1)
        out=[]
        for line in block.split("\n"):
            out.append(line)
            stripped=line.strip()
            if (stripped.startswith("next: ") or stripped.startswith("return: ")) and line.startswith("        ") and stripped!=f"next: {success}":
                out.append("        command_gates: skip")
        s=s[:start]+"\n".join(out)+s[end:]
    return s
def ref(kind, name): return f"../facets/{kind}/builtin-{name}.md"
def own(kind, name): return f"../facets/{kind}/{name}.md"
def section_map(pol_b, know_b, instr_b, instr_own, rep_b):
    out=["policies:"]+[f"  {n}: {ref('policies',n)}" for n in pol_b]+[f"  {n}: {own('policies',n)}" for n in DDD_POL]
    out+=["knowledge:"]+[f"  {n}: {ref('knowledge',n)}" for n in know_b]+[f"  {n}: {own('knowledge',n)}" for n in DDD_KNOW]
    if instr_b or instr_own:
        out+=["instructions:"]+[f"  {n}: {own('instructions',n)}" for n in instr_own]+[f"  {n}: {ref('instructions',n)}" for n in instr_b]
    if rep_b:
        out+=["report_formats:"]+[f"  {n}: {ref('output-contracts',n)}" for n in rep_b]
    return "\n".join(out)+"\n"
def sub1(s,a,b):
    assert s.count(a)==1,(a[:60],s.count(a)); return s.replace(a,b)
def retitle(s,name,desc):
    lines=s.split("\n",2); assert lines[0].startswith("name:") and lines[1].startswith("description:")
    return f"name: {name}\ndescription: {desc}\n"+lines[2]
refs_needed={"policies":set(),"knowledge":set(),"instructions":set(),"output-contracts":set()}
def need(kind, names):
    refs_needed[kind].update(names)
for lang in ("en","ja"):
    t=T[lang]; wf=f"{BUILTIN}/{lang}/workflows"
    # ddd-implement
    s=open(f"{wf}/development-implement-dynamic.yaml").read()
    s=retitle(s,"ddd-implement",t["impl_desc"])
    m=section_map(["coding","testing","ai-antipattern"],["architecture","implementation-semantics"],[],["ddd-implement","ddd-reimplement"],["coder-scope"])
    need("policies",["coding","testing","ai-antipattern"]); need("knowledge",["architecture","implementation-semantics"]); need("output-contracts",["coder-scope"])
    s=sub1(s,"\nfacet_pools:\n","\n"+t["map_comment"]+m+t["pool_comment"]+"facet_pools:\n")
    df="    dynamic_facets:\n      pool:\n        $param: implementation_pool\n"
    assert s.count(df)==2; s=s.replace(df,"")
    s=add_gates(s,lang,["implement","reimplement"],"COMPLETE")
    open(f"{lang}/workflows/ddd-implement.yaml","w").write(s)
    # ddd-remediation
    s=open(f"{wf}/development-remediation-dynamic.yaml").read()
    s=retitle(s,"ddd-remediation",t["rem_desc"])
    rem_b=["scenario-based-fix-plan-from-review-resolution","scenario-based-fix-replan"]
    m=section_map(["coding","testing","ai-antipattern","review","architecture"],["architecture","implementation-semantics","unit-testing","e2e-testing"],rem_b,[],["scenario-based-fix-plan"])
    need("policies",["coding","testing","ai-antipattern","review","architecture"]); need("knowledge",["architecture","implementation-semantics","unit-testing","e2e-testing"]); need("instructions",rem_b); need("output-contracts",["scenario-based-fix-plan"])
    s=sub1(s,"\nfacet_pools:\n","\n"+t["map_comment"]+m+"facet_pools:\n")
    df="    dynamic_facets:\n      pool:\n        $param: fix_pool\n"
    assert s.count(df)==2; s=s.replace(df,"")
    s=add_gates(s,lang,["fix","fix-retry"],"fix-verifier")
    open(f"{lang}/workflows/ddd-remediation.yaml","w").write(s)
    # ddd-review
    s=open(f"{wf}/development-review.yaml").read()
    s=retitle(s,"ddd-review",t["rev_desc"])
    m=section_map([],["architecture","unit-testing","e2e-testing"],REVIEW_INSTR,[],[])
    s=sub1(s,"    review_knowledge_additions:\n      type: facet_ref[]\n      facet_kind: knowledge\n      default: []\n","    review_knowledge_additions:\n      type: facet_ref[]\n      facet_kind: knowledge\n      default: [ddd-modeling]\n")
    need("knowledge",["architecture","unit-testing","e2e-testing"]); need("instructions",REVIEW_INSTR)
    s=sub1(s,"\nfacet_pools:\n","\n"+t["map_comment"]+m+"facet_pools:\n")
    for stepname in ("development-backend-reviewer","peer-review-cqrs-reviewer"):
        a=s.index(f"        - uses: {stepname}\n"); b=s.index("        - uses: ",a+10); s=s[:a]+s[b:]
    ddd_entry="""        - uses: ddd-reviewer
          with:
            review_policy_additions:
              $param: review_policy_additions
            review_knowledge_additions:
              $param: review_knowledge_additions
          rules: *reviewer_rules
"""
    s=sub1(s,"      pool:\n        - uses: development-architecture-reviewer\n", ddd_entry+"      pool:\n        - uses: development-architecture-reviewer\n")
    for child in ("backend-review","cqrs-es-review"):
        s=sub1(s,f"        {child}:\n          - condition: approved\n          - condition: needs_fix\n","")
    s=sub1(s,"      parallel:\n        ai-antipattern-review:\n","      parallel:\n        ddd-review:\n          - condition: approved\n          - condition: needs_fix\n        ai-antipattern-review:\n")
    open(f"{lang}/workflows/ddd-review.yaml","w").write(s)
    # builtin reference files
    for kind,names in refs_needed.items():
        for n in sorted(names):
            src=f"{BUILTIN}/{lang}/facets/{kind}/{n}.md"; assert os.path.exists(src), src
            p=f"{lang}/facets/{kind}/builtin-{n}.md"
            if not os.path.exists(p): open(p,"w").write(f"{{extends:{n}}}\n")
print("generated")
