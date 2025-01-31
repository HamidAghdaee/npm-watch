"use strict";

var path = require("path");
var spawn = require("child_process").spawn;

var through = require("through2");

var npm = process.platform === "win32" ? "npm.cmd" : "npm";
var nodemon = process.platform === "win32" ? "nodemon.cmd" : "nodemon";
var clearCharacter =
  process.platform === "win32" ? "\x1B[2J\x1B[0f" : "\x1B[2J\x1B[3J\x1B[H";

var pkgDir = "";
var stdin = null;

module.exports = function watchPackage(
  _pkgDir,
  exit,
  taskName,
  configFilePath
) {
  pkgDir = _pkgDir;
  var pkg = require(path.join(pkgDir, "package.json"));
  let watch = pkg.watch || {};
  if (configFilePath) {
    const config = require(configFilePath);
    const configWatch = config.watch || {};

    watch = { ...configWatch, ...watch };
  }

  var processes = {};

  taskName = typeof taskName !== "undefined" ? taskName.trim() : "";

  if (taskName === "") {
    console.info("No task specified. Will go through all possible tasks");
  }

  if (Object.values(watch).length === 0) {
    die('No "watch" config specified');
  }

  // send 'rs' commands to the right proc
  stdin = through(function(line, _, callback) {
    line = line.toString();
    var match = line.match(/^rs\s+(\w+)/);
    if (!match) {
      console.log("Unrecognized input:", line);
      return callback();
    }
    var proc = processes[match[1]];
    if (!proc) {
      console.log("Couldn't find process:", match[1]);
      return callback();
    }
    proc.stdin.write("rs\n");
    callback();
  });

  stdin.stderr = through();
  stdin.stdout = through();

  if (taskName !== "") {
    if (!pkg.scripts[taskName]) {
      console.info('No such script "' + taskName + '"');
    }
    startScript(taskName, watch, processes);
  } else {
    Object.keys(watch).forEach(function(script) {
      if (!pkg.scripts[script]) {
        console.info('No such script "' + script + '"');
      }
      startScript(script, watch, processes);
    });
  }

  return stdin;

  function die(message, code) {
    process.stderr.write(message);

    if (stdin) {
      stdin.end();
      stdin.stderr.end();
      stdin.stdout.end();
    }
    exit(code || 1);
  }
};

function prefixer(prefix) {
  return through(function(line, _, callback) {
    line = line.toString();
    if (!line.match("to restart at any time")) {
      this.push(prefix + " " + line);
    }
    callback();
  });
}

function startScript(script, watch, processes) {
  var exec = [npm, "run", "-s", script].join(" ");
  var patterns = null;
  var extensions = null;
  var ignores = null;
  var quiet = null;
  var inherit = null;
  var legacyWatch = null;
  var delay = null;
  var clearBuffer = null;
  var verbose = null;
  var runOnChangeOnly = null;
  var silent = null;

  if (typeof watch[script] === "object" && !Array.isArray(watch[script])) {
    patterns = watch[script].patterns;
    extensions = watch[script].extensions;
    ignores = watch[script].ignore;
    quiet = watch[script].quiet;
    inherit = watch[script].inherit;
    legacyWatch = watch[script].legacyWatch;
    delay = watch[script].delay;
    clearBuffer = watch[script].clearBuffer;
    verbose = watch[script].verbose;
    runOnChangeOnly = watch[script].runOnChangeOnly;
    silent = watch[script].silent;
  } else {
    patterns = watch[script];
  }

  if (verbose && silent) {
    console.error("Silent and Verbose can not both be on");
  }
  patterns = []
    .concat(patterns)
    .map(function(pattern) {
      return ["--watch", pattern];
    })
    .reduce(function(a, b) {
      return a.concat(b);
    });

  if (ignores) {
    ignores = []
      .concat(ignores)
      .map(function(ignore) {
        return ["--ignore", ignore];
      })
      .reduce(function(a, b) {
        return a.concat(b);
      });
  }

  var args = extensions ? ["--ext", extensions] : [];
  args = args.concat(patterns);
  if (ignores) {
    args = args.concat(ignores);
  }
  if (legacyWatch) {
    args = args.concat(["--legacy-watch"]);
  }
  if (delay) {
    args = args.concat(["--delay", delay + "ms"]);
  }
  if (verbose) {
    args = args.concat(["-V"]);
  }
  if (silent) {
    args = args.concat(["-q"]);
  }
  if (runOnChangeOnly) {
    args = args.concat(["--on-change-only"]);
  }
  args = args.concat(["--exec", exec]);

  var proc = (processes[script] = spawn(nodemon, args, {
    env: process.env,
    cwd: pkgDir,
    stdio: inherit === true ? ["pipe", "inherit", "pipe"] : "pipe"
  }));
  if (inherit === true) return;

  if (clearBuffer === true) {
    proc.stdout.pipe(
      through(function(line, _, callback) {
        line = line.toString();
        if (line.match("restarting due to changes...")) {
          stdin.stdout.write(clearCharacter);
        }
        callback();
      })
    );
  }

  if (quiet === true || quiet === "true") {
    proc.stdout.pipe(stdin.stdout);
    proc.stderr.pipe(stdin.stderr);
  } else {
    proc.stdout.pipe(prefixer("[" + script + "]")).pipe(stdin.stdout);
    proc.stderr.pipe(prefixer("[" + script + "]")).pipe(stdin.stderr);
  }
}
