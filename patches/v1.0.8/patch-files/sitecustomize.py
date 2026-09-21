"""EnterpriseAI runtime patch loader - v1.0.8 (numpy vector backend).

Key behavior: patches dir is APPENDED to sys.path (not inserted at front),
then patched modules are pre-loaded directly via spec_from_file_location
into sys.modules. This mirrors what v1.0.7 effectively did in production:
PyInstaller's frozen importer owns the `core`, `services`, `utils`, and
`routers` packages (their __init__.py lives in _internal), and our
replacement submodules slot in via sys.modules without shadowing package
__path__ so that sibling imports (like ``from .config import settings``)
resolve to the frozen originals.
"""
import os, sys, importlib.util, traceback
_HERE = os.path.dirname(os.path.abspath(__file__))
_PATCH_DIR = os.path.join(_HERE, "patches")
# Append, NOT insert-at-front. PyInstaller puts _internal first; we want
# frozen __init__.py for each package to come from _internal so relative
# imports in our replacement modules can find non-patched siblings.
if _PATCH_DIR not in sys.path:
    sys.path.append(_PATCH_DIR)

def _sc_log(msg):
    try:
        ad = os.environ.get("APPDATA")
        if ad:
            ld = os.path.join(ad, "EnterpriseAI", "logs")
            os.makedirs(ld, exist_ok=True)
            with open(os.path.join(ld, "patch-v1.0.8.log"), "a", encoding="utf-8") as f:
                f.write("[sitecustomize] " + str(msg).rstrip() + "\n")
    except Exception:
        pass

_sc_log("starting; __file__=%s; sys.path[0]=%s; sys.path has _PATCH_DIR=%s"
        % (__file__, sys.path[0] if sys.path else "(none)", _PATCH_DIR in sys.path))

_PATCHES = [
    ("utils.persian",                os.path.join(_PATCH_DIR,"utils","persian.py")),
    ("core.database",                os.path.join(_PATCH_DIR,"core","database.py")),
    ("services.normalizer_service",  os.path.join(_PATCH_DIR,"services","normalizer_service.py")),
    ("services.embedding_service",   os.path.join(_PATCH_DIR,"services","embedding_service.py")),
    ("services.reranker_service",    os.path.join(_PATCH_DIR,"services","reranker_service.py")),
    ("services.llm_service",         os.path.join(_PATCH_DIR,"services","llm_service.py")),
    ("services.rag_service",         os.path.join(_PATCH_DIR,"services","rag_service.py")),
]
def _load(name,path):
    try:
        if not os.path.exists(path):
            _sc_log("skip %s: file not found at %s" % (name, path))
            return False
        spec=importlib.util.spec_from_file_location(name,path)
        if not spec or not spec.loader:
            _sc_log("skip %s: no spec/loader" % name)
            return False
        m=importlib.util.module_from_spec(spec); sys.modules[name]=m
        spec.loader.exec_module(m)
        print("[patch v1.0.8] loaded " + name)
        _sc_log("loaded " + name)
        return True
    except Exception as e:
        sys.modules.pop(name, None)
        print("[patch v1.0.8] FAIL " + name + ": " + str(e), file=sys.stderr)
        _sc_log("FAIL " + name + ": " + repr(e))
        traceback.print_exc(file=sys.stderr)
        return False
_n=0
for _name,_path in _PATCHES:
    if _load(_name,_path): _n+=1
print("[patch v1.0.8] active: %d/%d modules" % (_n, len(_PATCHES)))
_sc_log("active: %d/%d" % (_n, len(_PATCHES)))
