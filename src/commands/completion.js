const { COMMANDS } = require("../command-registry");
const { DEFAULT_API_VERSION } = require("../constants");

function quoteZshSingle(value) {
  return value.replace(/'/g, "'\\''");
}

function buildZshCompletionScript() {
  const commands = COMMANDS.filter((c) => c.name !== "help");
  const commandDescriptions = commands.map(
    (c) => `'${quoteZshSingle(c.name)}:${quoteZshSingle(c.description)}'`
  );
  const commandFlags = {};
  for (const command of commands) {
    commandFlags[command.name] = {
      flags: command.flags.slice().sort(),
      shortFlags: (command.shortFlags || []).slice().sort(),
    };
  }

  const lines = [];
  lines.push("#compdef ybsf");
  lines.push("");
  lines.push("_ybsf() {");
  lines.push("  local context state line");
  lines.push("  typeset -A opt_args");
  lines.push("");
  lines.push(`  local -a commands=(${commandDescriptions.join(" ")})`);
  lines.push("");
  lines.push("  if (( CURRENT == 2 )); then");
  lines.push("    _describe 'command' commands");
  lines.push("    return");
  lines.push("  fi");
  lines.push("");
  lines.push("  local cmd=${words[2]}");
  lines.push("  case \"$cmd\" in");
  for (const command of commands) {
    lines.push(`    ${command.name})`);
    const { flags, shortFlags } = commandFlags[command.name];
    if (flags.length === 0 && shortFlags.length === 0) {
      lines.push("      return");
      lines.push("      ;;");
      continue;
    }
    const shortByLong = {};
    for (const short of shortFlags) {
      if (short === "-i") shortByLong["--input-dir"] = short;
      else if (short === "-d") shortByLong["--output-dir"] = short;
      else if (short === "-f") shortByLong["--force"] = short;
      else if (short === "-a") shortByLong["--api-version"] = short;
      else if (short === "-c") shortByLong["--config"] = short;
      else if (short === "-p") shortByLong["--output"] = short;
      else if (short === "-o") shortByLong["--target-org"] = short;
    }
    lines.push("      _arguments \\");
    flags.forEach((flag, idx) => {
      const suffix = idx === flags.length - 1 ? "" : " \\";
      const short = shortByLong[flag];
      const flagSpec = short ? `'(${short} ${flag}){${short},${flag}}` : `'${flag}`;
      if (flag === "--config") {
        lines.push(`        ${flagSpec}[Path to config file]:config file:_files'${suffix}`);
      } else if (flag === "--output") {
        lines.push(`        ${flagSpec}[Output path]:output path:_files'${suffix}`);
      } else if (flag === "--input-dir" || flag === "--output-dir") {
        lines.push(`        ${flagSpec}[Directory]:directory:_files -/'${suffix}`);
      } else if (flag === "--target-org") {
        lines.push(`        ${flagSpec}[Target org alias]:org alias:'${suffix}`);
      } else if (flag === "--api-version") {
        lines.push(`        ${flagSpec}[API version (for example ${DEFAULT_API_VERSION})]:api version:'${suffix}`);
      } else {
        lines.push(`        ${flagSpec}[Flag]'${suffix}`);
      }
    });
    lines.push("      ;;");
  }
  lines.push("    completion)");
  lines.push("      if (( CURRENT == 3 )); then");
  lines.push("        _values 'shell' zsh");
  lines.push("      fi");
  lines.push("      ;;");
  lines.push("  esac");
  lines.push("}");
  lines.push("");
  lines.push("compdef _ybsf ybsf");
  lines.push("");

  return `${lines.join("\n")}`;
}

function runCompletion({ shell }) {
  if (shell !== "zsh") {
    throw new Error(`Unsupported shell: ${shell}. Currently supported: zsh`);
  }
  return buildZshCompletionScript();
}

module.exports = {
  runCompletion,
};
