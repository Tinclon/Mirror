"use strict";

console.infoNoLn = args => process.stdout.write(args);

const path = require("path");
const fs = require("fs");
const util = require("util");

const forbiddenDirectories = {};
forbiddenDirectories["$RECYCLE.BIN"] = true;
forbiddenDirectories[".fseventsd"] = true;
forbiddenDirectories[".Trashes"] = true;
forbiddenDirectories[".TemporaryItems"] = true;
forbiddenDirectories["System Volume Information"] = true;

const forbiddenFiles = {};
forbiddenFiles["Thumbs.db"] = true;
forbiddenFiles["desktop.ini"] = true;
forbiddenFiles[".DS_Store"] = true;

const paths = {
    R: "/Volumes",  // ROOT
    M: "",          // MASTER
    S: ""           // SLAVE
};

const getDirectories = srcpath => fs.readdirSync(srcpath).filter(file => fs.statSync(path.join(srcpath, file)).isDirectory());
const getFiles = srcpath => fs.readdirSync(srcpath).filter(file => !fs.statSync(path.join(srcpath, file)).isDirectory());
const pathExists = srcpath => fs.existsSync(srcpath);
const createDirectory = srcpath => fs.mkdirSync(srcpath);
const deleteFile = srcpath => fs.unlinkSync(srcpath);
const deleteDirectory = srcpath => (srcpath.length < 8 && (console.error("DON'T RECURSIVELY DELETE SHORT PATHS!!!") || true)) || fs.readdirSync(srcpath).forEach(file => fs.statSync(path.join(srcpath,file)).isDirectory() && deleteDirectory(path.join(srcpath,file)) || fs.unlinkSync(path.join(srcpath, file))) || fs.rmdirSync(srcpath);
const copyFile = (srcPath, destPath) => fs.writeFileSync(destPath, fs.readFileSync(srcPath)) || fs.utimesSync(destPath, fs.statSync(srcPath).atime, fs.statSync(srcPath).mtime);
const getTimestamp = srcPath => new Date(util.inspect(fs.statSync(srcPath).mtime));
const timestampsDiffer = (timestamp1, timestamp2) =>
    Math.abs(timestamp1.getTime() - timestamp2.getTime()) >= 2000 &&
        // Account for DST
        Math.abs(timestamp1.getTime() + (1000 * 60 * 60) - timestamp2.getTime()) >= 2000 &&
        Math.abs(timestamp1.getTime() - (1000 * 60 * 60) - timestamp2.getTime()) >= 2000;

function formatPath(srcpath) {
    if (srcpath.length < 500) { return srcpath; }
    const parts = srcpath.split(path.sep);
    let mid = parts.length >> 1, delta = 0;
    while(mid + delta >= 0 && parts[mid + delta] === "…") { --delta; }
    mid + delta >= 0 && (parts[mid + delta] = "…");
    mid - delta < parts.length && (parts[mid - delta] = "…");
    return formatPath(parts.join(path.sep));
}

function mirrorFiles(mFullDirectory, sFullDirectory, actionOccurredPreviously) {
    let actionOccurred = false;

    // ** FILES **
    {
        const mFiles = getFiles(mFullDirectory);
        const sFiles = getFiles(sFullDirectory);
        sFiles.forEach(sFile => {
            if (forbiddenFiles[sFile]) { return; }
            if (!mFiles.filter(mFile => mFile === sFile).length) {
                // Exists in SLAVE, not in MASTER. Delete file from SLAVE.
                console.info(`delete file\t${formatPath(path.join(sFullDirectory, sFile))}`);
                actionOccurred = true;
                deleteFile(path.join(sFullDirectory, sFile));
            }
        });
    }
    {
        const mFiles = getFiles(mFullDirectory);
        const sFiles = getFiles(sFullDirectory);
        mFiles.forEach(mFile => {
            if (forbiddenFiles[mFile]) { return; }
            if (!sFiles.filter(sFile => sFile === mFile).length) {
                // Exists in MASTER, not in SLAVE. Copy file to SLAVE.
                console.info(`copy file\t${formatPath(path.join(sFullDirectory, mFile))}`);
                actionOccurred = true;
                copyFile(path.join(mFullDirectory, mFile), path.join(sFullDirectory, mFile));
            } else {
                // Exists in MASTER and in SLAVE. Compare modification timestamps.
                const mModificationTime = getTimestamp(path.join(mFullDirectory, mFile));
                const sModificationtime = getTimestamp(path.join(sFullDirectory, mFile));
                if(timestampsDiffer(mModificationTime, sModificationtime)) {
                    // Files were modified at a different time. Copy file to SLAVE (and overwrite).
                    console.info(`update file\t${formatPath(path.join(sFullDirectory, mFile))}`);
                    actionOccurred = true;
                    copyFile(path.join(mFullDirectory, mFile), path.join(sFullDirectory, mFile));
                }
            }
        });
    }

    if (!actionOccurred) {
        actionOccurredPreviously && console.info();
        console.infoNoLn(".");
    }

    // ** DIRECTORIES **
    {
        const mDirectories = getDirectories(mFullDirectory);
        const sDirectories = getDirectories(sFullDirectory);
        sDirectories.forEach(sDirectory => {
            if (forbiddenDirectories[sDirectory]) { return; }
            if (!mDirectories.filter(mDirectory => mDirectory === sDirectory).length) {
                // Exists in SLAVE, not in MASTER. Delete directory from SLAVE.
                console.info(`delete dir\t${formatPath(path.join(sFullDirectory, sDirectory))}`);
                actionOccurred = true;
                deleteDirectory(path.join(sFullDirectory, sDirectory));
            }
        });
    }
    {
        const mDirectories = getDirectories(mFullDirectory);
        const sDirectories = getDirectories(sFullDirectory);
        mDirectories.forEach(mDirectory => {
            if (forbiddenDirectories[mDirectory]) { return; }
            if (!sDirectories.filter(sDirectory => sDirectory === mDirectory).length) {
                // Exists in MASTER, not in SLAVE. Create directory on SLAVE.
                console.info(`create dir\t${formatPath(path.join(sFullDirectory, mDirectory))}`);
                actionOccurred = true;
                createDirectory(path.join(sFullDirectory, mDirectory));
            }
            // Exists in MASTER and in SLAVE. Recurse.
            actionOccurred = mirrorFiles(path.join(mFullDirectory, mDirectory), path.join(sFullDirectory, mDirectory), actionOccurred);
        });
    }

    return actionOccurred;
}

(function mirror() {
    // Start by finding the MASTER and SLAVE Volumes
    const volumes = getDirectories(paths.R);
    volumes.forEach(volume => {
        const files = getFiles(path.join(paths.R, volume));
        paths.M = paths.M || files.filter(file => file === "MASTER")[0] && volume;
        paths.S = paths.S || files.filter(file => file === "SLAVE")[0] && volume;
    });

    if(!paths.M) {
        // MASTER Volume is not connected. Tell user and quit.
        console.info("Error: MASTER does not exist");
        return;
    }

    if(!paths.S) {
        // SLAVE Volume is not connected. Tell user and quit.
        console.info("Error: SLAVE does not exist");
        return;
    }

    const masterDirectories = getDirectories(path.join(paths.R, paths.M));
    masterDirectories.forEach(directory => {
        if(forbiddenDirectories[directory]) { return; }
        const mDirectory = path.join(paths.R, paths.M, directory);
        const sDirectory = path.join(paths.R, paths.S, directory);
        !pathExists(sDirectory) && (createDirectory(sDirectory) || console.info(`create dir\t${formatPath(sDirectory)}`));
        mirrorFiles(mDirectory, sDirectory, false) && console.info();
    });
    console.info();

})();