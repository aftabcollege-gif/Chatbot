"""Direct self-test for Chatbot Enterprise v1.0.8 patch.

Run with the embedded python.exe from inside _internal:
    python test-patch-v1.0.8.py
"""
import sys, os, traceback
out = []
def p(m):
    print(m, flush=True)
    out.append(str(m))
def main():
    p("=== Chatbot Enterprise v1.0.8 patch self-test ===")
    p("python: " + sys.version.split()[0] + " at " + sys.executable)
    p("cwd: " + os.getcwd())
    # 1) numpy
    try:
        import numpy as np
        p("[OK] numpy " + np.__version__)
    except Exception as e:
        p("[FAIL] cannot import numpy: " + repr(e))
        traceback.print_exc()
        return 2
    # 2) core.database (sitecustomize preloads it)
    try:
        import core.database as db
        loc = getattr(db, "__file__", "?")
        p("[OK] core.database: " + loc)
        if "patches" not in loc.replace("\\", "/"):
            p("[!!] core.database is the FROZEN version, not the patch!")
            return 3
        p("     vec_backend   = " + str(db.vec_backend()))
        p("     vec_available = " + str(db.vec_available()))
        p("     vec_load_error= " + str(db.vec_load_error()))
        p("     vec_loaded_path=" + str(db.vec_loaded_path()))
    except Exception as e:
        p("[FAIL] cannot import core.database: " + repr(e))
        traceback.print_exc()
        return 4
    if not db.vec_available():
        p("[FAIL] vec_available returned False (numpy backend not active)")
        return 5
    # 3) Check appdata marker/log if possible
    ad = os.environ.get("APPDATA")
    if ad:
        marker = os.path.join(ad, "EnterpriseAI", "patch-v1.0.8-applied.txt")
        log = os.path.join(ad, "EnterpriseAI", "logs", "patch-v1.0.8.log")
        p("appdata marker: " + ("YES" if os.path.exists(marker) else "NO") + "  (" + marker + ")")
        p("patch log     : " + ("YES" if os.path.exists(log) else "NO") + "  (" + log + ")")
    p("")
    p("=== ALL CHECKS PASSED ===")
    return 0
if __name__ == "__main__":
    rc = main()
    try:
        rp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-patch-result.txt")
        with open(rp, "w", encoding="utf-8") as f:
            f.write("\n".join(out) + "\n")
        p("result written: " + rp)
    except Exception:
        pass
    sys.exit(rc)
