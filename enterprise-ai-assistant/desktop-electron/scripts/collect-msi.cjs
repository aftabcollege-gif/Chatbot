// electron-builder "afterAllArtifactBuild" hook.
//
// The CI packaging step (main.yml, "Create release package and checksums")
// copies installers into the release folder with:
//     Copy-Item "$stage\*.exe","stage\*.msi" "$release\" ...
// The second path is missing the "$" so it resolves to the RELATIVE path
// enterprise-ai-assistant/stage/*.msi, which normally does not exist and the
// workflow cannot be edited from this branch. Materialize the MSI there so the
// published release folder contains both the setup exe and the MSI.
// Never throws: a failure here must not break the packaging build.
const fs = require("fs");
const path = require("path");

module.exports = function (buildResult) {
  try {
    const root = path.resolve(__dirname, "..", ".."); // enterprise-ai-assistant
    const distDir = path.join(root, "dist-electron");
    const stageDir = path.join(root, "stage");
    fs.mkdirSync(stageDir, { recursive: true });
    const msis = fs.existsSync(distDir)
      ? fs.readdirSync(distDir).filter((f) => f.toLowerCase().endsWith(".msi"))
      : [];
    for (const msi of msis) {
      fs.copyFileSync(path.join(distDir, msi), path.join(stageDir, msi));
      console.log(`[collect-msi] staged ${msi} into ${stageDir}`);
    }
    if (msis.length === 0) {
      console.warn(`[collect-msi] no MSI found in ${distDir}`);
    }
  } catch (err) {
    console.warn(`[collect-msi] non-fatal: ${err && err.message}`);
  }
  return buildResult;
};
