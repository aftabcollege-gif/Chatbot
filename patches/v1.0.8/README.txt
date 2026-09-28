Chatbot Enterprise - Patch v1.0.8
=================================

This patch replaces the sqlite-vec vector extension with a pure-numpy in-memory
vector index so the chatbot works out of the box without needing an external
vec0.dll.

This revision (v1.0.8-r2) also fixes the answer-quality problems reported in
chat: wrong/duplicated sources, a repeated section, and "LLM stream error"
when the answer was generated. It does that by replacing the retrieval and
generation modules with fixed versions:

  - نیم‌فاصله (ZWNJ): a word written with or without نیم‌فاصله now finds the
    other spelling ("می‌شود" / "می شود"), and common words like «فرآیند»,
    «توضیح» or «مختصر» no longer match every document.
  - Sources: only chunks that really contain the question's distinctive words
    (or are semantically close) are cited; one document can contribute at most
    two chunks and duplicate/overlapping passages are merged, so the same file
    no longer appears four times.
  - Repeated sections: the same sentence is never repeated in the answer.
  - «LLM stream error»: every request is planned against the model's real
    context window (and the request is retried with a smaller context or, if
    the model is unavailable, answered from the retrieved text), so the chat
    always returns an answer instead of a raw error.

You do NOT need to re-upload your documents for these fixes. Only run
Reset-Setup.bat if you are installing the patch for the first time (or you hit
the /setup redirect loop); if you want a clean index because your library
changed a lot, run Reset-Setup.bat and upload the documents again.

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
  Test-Patch.exe                       - runs a numpy-vector + answer-quality test
  patch-files/                         - the actual patched Python modules
  *.bat                                - underlying scripts (used by the EXEs)
