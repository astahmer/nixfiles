import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const releaseUrl =
  "https://web.whatsapp.com/desktop/mac_native/release/?configuration=Release&src=whatsapp_downloads_desktop_page";

const fetchWithRetry = async (url: string): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`${response.status} ${response.statusText} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(attempt * 1_000);
  }
  throw lastError;
};

const repoRoot = (await $`jj root`.text()).trim();
const packageFile = join(repoRoot, "packages/whatsapp-bin/default.nix");

const releaseResponse = await fetchWithRetry(releaseUrl);
await releaseResponse.body?.cancel();
const version = /WhatsApp-([0-9][0-9.]*)\.dmg/.exec(releaseResponse.url)?.[1];
if (version === undefined) {
  throw new Error(`update-whatsapp: could not determine the release version from ${releaseResponse.url}`);
}

const originalPackage = await Bun.file(packageFile).text();
const currentVersion = /^\s*version = "([^"]*)";/m.exec(originalPackage)?.[1];
if (currentVersion === version) {
  console.log(`update-whatsapp: ${version} is already current`);
  process.exit(0);
}

const downloadUrl = `https://web.whatsapp.com/desktop/mac_native/release/?version=${version}&extension=dmg&configuration=Release&branch=master`;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "update-whatsapp-"));
let updated = false;

try {
  const downloadFile = join(temporaryDirectory, `WhatsApp-${version}.dmg`);
  await Bun.write(downloadFile, await fetchWithRetry(downloadUrl));
  const hash = (await $`nix hash file --type sha256 --sri ${downloadFile}`.text()).trim();

  await Bun.write(
    packageFile,
    originalPackage
      .replace(/version = "[^"]+";/, () => `version = "${version}";`)
      .replace(/hash = "sha256-[^"]+";/, () => `hash = "${hash}";`),
  );

  const storePath = (await $`nix build ${`${repoRoot}#whatsapp-bin`} --no-link --print-out-paths`.text()).trim();
  const appPath = join(storePath, "Applications/WhatsApp.app");
  // The DMG is versioned 2.x.y.z while the bundle reports x.y.z.
  const expectedAppVersion = version.replace(/^2\./, "");
  const actualAppVersion = (
    await $`/usr/bin/plutil -extract CFBundleShortVersionString raw -o - ${join(appPath, "Contents/Info.plist")}`.text()
  ).trim();
  if (actualAppVersion !== expectedAppVersion) {
    throw new Error(`update-whatsapp: expected app version ${expectedAppVersion}, got ${actualAppVersion}`);
  }
  await $`/usr/bin/codesign --verify --deep --strict ${appPath}`;
  updated = true;
  console.log(`update-whatsapp: pinned signed WhatsApp ${version} (${hash})`);
} finally {
  if (!updated) await Bun.write(packageFile, originalPackage);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
