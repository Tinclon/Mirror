"use strict";

let infoNoLn = false;

console.infoNewLn = args => (infoNoLn && !console.info()) && !console.info(args) && (infoNoLn = false);
console.infoNoLn = args => (infoNoLn = true) && process.stdout.write(args);

const path = require("path");
const fs = require("fs-extra");
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
const deleteFile = srcpath => fs.removeSync(srcpath);
const deleteDirectory = srcpath => fs.removeSync(srcpath);
const copyFile = (srcpath, destpath) => fs.copySync(srcpath, destpath, {preserveTimestamps: true}) || fs.utimesSync(destpath, fs.statSync(srcpath).atime, fs.statSync(srcpath).mtime);
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
        sFiles.forEach(sFile => {
            if (forbiddenFiles[sFile]) { return; }
            if (!mFiles.filter(mFile => mFile === sFile).length) {
                // Exists in SLAVE, not in MASTER. Delete file from SLAVE.
                console.infoNewLn(`delete file\t${formatPath(path.join(sFullDirectory, sFile))}`);
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
                console.infoNewLn(`copy file\t${formatPath(path.join(sFullDirectory, mFile))}`);
                copyFile(path.join(mFullDirectory, mFile), path.join(sFullDirectory, mFile));
            } else {
                // Exists in MASTER and in SLAVE. Compare modification timestamps.
                const mModificationTime = getTimestamp(path.join(mFullDirectory, mFile));
                const sModificationtime = getTimestamp(path.join(sFullDirectory, mFile));
                if(timestampsDiffer(mModificationTime, sModificationtime)) {
                    // Files were modified at a different time. Copy file to SLAVE (and overwrite).
                    console.infoNewLn(`update file\t${formatPath(path.join(sFullDirectory, mFile))}`);
                    copyFile(path.join(mFullDirectory, mFile), path.join(sFullDirectory, mFile));
                }
            }
        });
    }

    // ** DIRECTORIES **
    {
        const mDirectories = getDirectories(mFullDirectory);
        const sDirectories = getDirectories(sFullDirectory);
        sDirectories.forEach(sDirectory => {
            if (forbiddenDirectories[sDirectory]) { return; }
            if (!mDirectories.filter(mDirectory => mDirectory === sDirectory).length) {
                // Exists in SLAVE, not in MASTER. Delete directory from SLAVE.
                console.infoNewLn(`delete dir\t${formatPath(path.join(sFullDirectory, sDirectory))}`);
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
                console.infoNewLn(`create dir\t${formatPath(path.join(sFullDirectory, mDirectory))}`);
                createDirectory(path.join(sFullDirectory, mDirectory));
            }
            console.infoNoLn(".");
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
        console.infoNewLn("Error: MASTER does not exist");
        return;
    }

    if(!paths.S) {
        // SLAVE Volume is not connected. Tell user and quit.
        console.infoNewLn("Error: SLAVE does not exist");
        return;
    }

    const masterDirectories = getDirectories(path.join(paths.R, paths.M));
    masterDirectories.forEach(directory => {
        if(forbiddenDirectories[directory]) { return; }
        const mDirectory = path.join(paths.R, paths.M, directory);
        const sDirectory = path.join(paths.R, paths.S, directory);
        !pathExists(sDirectory) && (createDirectory(sDirectory) || console.infoNewLn(`create dir\t${formatPath(sDirectory)}`));
        console.infoNoLn(".");        
        mirrorFiles(mDirectory, sDirectory, false);
    });
    console.info();

})();
