"use strict";

let dot = false;
console.status = args => ((dot && console.info()) || true) && (console.info(args) || true) && (dot = false);
console.dot = () => (dot = true) && process.stdout.write(".");

const path = require("path");
const fs = require("fs-extra");
const util = require("util");

const forbiddenDirectories = {};
forbiddenDirectories["Movies"] = true;
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
const deleteFile = srcpath => fs.removeSync(srcpath);
const deleteDirectory = srcpath => fs.removeSync(srcpath);
const copyFile = (srcpath, destpath) => fs.copySync(srcpath, destpath) || fs.utimesSync(destpath, fs.statSync(srcpath).atime, fs.statSync(srcpath).mtime);
const getTimestamp = srcpath => new Date(util.inspect(fs.statSync(srcpath).mtime));
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

function mirrorFiles(mFullDirectory, sFullDirectory) {

    // ** FILES **
    {
        const mFiles = getFiles(mFullDirectory);
        const sFiles = getFiles(sFullDirectory);
        sFiles.filter(sFile => !forbiddenFiles[sFile]).forEach(sFile => {
            if (!mFiles.filter(mFile => mFile === sFile).length) {
                // Exists in SLAVE, not in MASTER. Delete file from SLAVE.
                console.status(`delete file\t${formatPath(path.join(sFullDirectory, sFile))}`);
                deleteFile(path.join(sFullDirectory, sFile));
            }
        });
    }
    {
        const mFiles = getFiles(mFullDirectory);
        const sFiles = getFiles(sFullDirectory);
        mFiles.filter(mFile => !forbiddenFiles[mFile]).forEach(mFile => {
            if (!sFiles.filter(sFile => sFile === mFile).length) {
                // Exists in MASTER, not in SLAVE. Copy file to SLAVE.
                console.status(`copy file\t${formatPath(path.join(sFullDirectory, mFile))}`);
                copyFile(path.join(mFullDirectory, mFile), path.join(sFullDirectory, mFile));
            } else {
                // Exists in MASTER and in SLAVE. Compare modification timestamps.
                const mModificationTime = getTimestamp(path.join(mFullDirectory, mFile));
                const sModificationtime = getTimestamp(path.join(sFullDirectory, mFile));
                if(timestampsDiffer(mModificationTime, sModificationtime)) {
                    // Files were modified at a different time. Copy file to SLAVE (and overwrite).
                    console.status(`update file\t${formatPath(path.join(sFullDirectory, mFile))}`);
                    copyFile(path.join(mFullDirectory, mFile), path.join(sFullDirectory, mFile));
                }
            }
        });
    }

    // ** DIRECTORIES **
    {
        const mDirectories = getDirectories(mFullDirectory);
        const sDirectories = getDirectories(sFullDirectory);
        sDirectories.filter(sDirectory => !forbiddenDirectories[sDirectory]).forEach(sDirectory => {
            if (!mDirectories.filter(mDirectory => mDirectory === sDirectory).length) {
                // Exists in SLAVE, not in MASTER. Delete directory from SLAVE.
                console.status(`delete dir\t${formatPath(path.join(sFullDirectory, sDirectory))}`);
                deleteDirectory(path.join(sFullDirectory, sDirectory));
            }
        });
    }
    {
        const mDirectories = getDirectories(mFullDirectory);
        const sDirectories = getDirectories(sFullDirectory);
        mDirectories.filter(mDirectory => !forbiddenDirectories[mDirectory]).forEach(mDirectory => {
            if (!sDirectories.filter(sDirectory => sDirectory === mDirectory).length) {
                // Exists in MASTER, not in SLAVE. Create directory on SLAVE.
                console.status(`create dir\t${formatPath(path.join(sFullDirectory, mDirectory))}`);
                createDirectory(path.join(sFullDirectory, mDirectory));
            }
            console.dot();
            // Exists in MASTER and in SLAVE. Recurse.
            mirrorFiles(path.join(mFullDirectory, mDirectory), path.join(sFullDirectory, mDirectory));
        });
    }
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
    masterDirectories.filter(directory => !forbiddenDirectories[directory]).forEach(directory => {
        const mDirectory = path.join(paths.R, paths.M, directory);
        const sDirectory = path.join(paths.R, paths.S, directory);
        !pathExists(sDirectory) && (createDirectory(sDirectory) || console.status(`create dir\t${formatPath(sDirectory)}`));
        mirrorFiles(mDirectory, sDirectory);
    });
    console.info();

})();
