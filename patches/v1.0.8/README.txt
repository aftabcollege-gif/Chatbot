Chatbot Enterprise - Patch v1.0.8
=================================

This patch replaces the sqlite-vec vector extension with a pure-numpy in-memory
vector index so the chatbot works out of the box without needing an external
vec0.dll.

---------------------------------------------------------------
INSTALL  (double-click only - NO cmd / PowerShell needed)
---------------------------------------------------------------
1. Extract this ZIP into a new EMPTY folder (anywhere, e.g. on your Desktop).
2. Double-click  ChatbotEnterprise-Patch-v1.0.8.exe
     - If Windows SmartScreen warns you, click "More info" -> "Run anyway".
     - A console window will open showing patch progress.
     - When it prints   "=== PATCH APPLIED SUCCESSFULLY ==="  you can close it.
3. Double-click  Reset-Setup.exe
     - This stops the app, backs up + deletes enterprise.db so the first-run
       setup wizard appears again.
     - When it asks "Type YES and press Enter", type YES and press Enter.
     - Wait for it to open http://127.0.0.1:8741/setup in your browser.
4. Go through the first-run setup wizard (admin account, organization).
5. After logging in, open the System Health page. It should show:
        vector_extension : ok
        vector_backend   : numpy
     and semantic search will work without any extra DLLs.

If the /setup URL redirects to /login, just run Reset-Setup.exe again (and
use an Incognito/Private window to bypass any cached session cookie).

---------------------------------------------------------------
TROUBLESHOOTING
---------------------------------------------------------------
- If you need diagnostic info, double-click Diag-Patch.exe and then look at
  %APPDATA%\EnterpriseAI\logs\patch-v1.0.8.log and at
  C:\Program Files\Chatbot Enterprise\_internal\test-patch-result.txt
- To test semantic search directly, run Test-Patch.exe and check
  _internal\test-patch-result.txt for the ranked results.

Contents of this folder:
  ChatbotEnterprise-Patch-v1.0.8.exe   - applies the patch (double-click)
  Reset-Setup.exe                      - deletes enterprise.db so /setup appears
  Diag-Patch.exe                       - writes a diagnostic log
  Test-Patch.exe                       - runs a numpy-vector test
  patch-files/                         - the actual patched Python modules
  *.bat                                - underlying scripts (used by the EXEs)
