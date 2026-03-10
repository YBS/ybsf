const COMMANDS = [
  {
    name: "convert-config",
    description: "Convert legacy config files to ybsf-metadata-config.json",
    flags: [
      "--input-dir",
      "--output-dir",
      "--target-org",
      "--api-version",
      "--force",
      "--includeManagedPackages",
      "--includeUnlockedPackages",
      "--debug",
    ],
    shortFlags: ["-i", "-d", "-o", "-a", "-f"],
  },
  {
    name: "init-project",
    description: "Initialize SFDX project structure and optionally convert legacy config",
    flags: [
      "--api-version",
      "--target-org",
      "--force",
      "--includeManagedPackages",
      "--includeUnlockedPackages",
      "--debug",
    ],
    shortFlags: ["-a", "-o", "-f"],
  },
  {
    name: "generate-manifest",
    description: "Generate manifest/package.xml from JSON config",
    flags: ["--config", "--output", "--target-org", "--debug"],
    shortFlags: ["-c", "-p", "-o"],
  },
  {
    name: "normalize-config",
    description: "Normalize ybsf-metadata-config.json and optionally reconcile to org discovery",
    flags: [
      "--config",
      "--target-org",
      "--init-mode",
      "--includeManagedPackages",
      "--includeUnlockedPackages",
      "--debug",
    ],
    shortFlags: ["-c", "-o", "-i"],
  },
  {
    name: "retrieve",
    description: "Generate manifest, retrieve metadata, and run post-retrieve transforms",
    flags: ["--target-org", "--debug"],
    shortFlags: ["-o"],
  },
  {
    name: "destructive-preview",
    description: "Generate destructive candidate summary from org vs desired manifest",
    flags: ["--config", "--target-org", "--debug"],
    shortFlags: ["-c", "-o"],
  },
  {
    name: "validate-deploy",
    description: "Run check-only deploy from manifest/package.xml with optional destructive apply",
    flags: ["--config", "--target-org", "--apply-destructive", "--test-level", "--tests", "--debug"],
    shortFlags: ["-c", "-o", "-l", "-t"],
  },
  {
    name: "deploy",
    description: "Run deploy from manifest/package.xml with optional destructive apply",
    flags: ["--config", "--target-org", "--apply-destructive", "--test-level", "--tests", "--debug"],
    shortFlags: ["-c", "-o", "-l", "-t"],
  },
  {
    name: "document",
    description: "Generate metadata documentation CSV files",
    flags: ["--object", "--all", "--source-dir", "--output-dir", "--target-org", "--debug"],
    shortFlags: ["-a", "-s", "-d", "-o"],
  },
  {
    name: "completion",
    description: "Print shell completion script",
    flags: [],
    shortFlags: [],
  },
  {
    name: "version",
    description: "Print CLI version",
    flags: [],
    shortFlags: [],
  },
  {
    name: "help",
    description: "Show help",
    flags: [],
    shortFlags: [],
  },
];

function getCommand(name) {
  return COMMANDS.find((c) => c.name === name) || null;
}

module.exports = {
  COMMANDS,
  getCommand,
};
