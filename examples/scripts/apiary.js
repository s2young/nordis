/**
 This script outputs apiary-compatible documentation for the api, based on what is provided in the config file.
 **/
var AppConfig = require('./../../lib/AppConfig');
// You would want this:
// var AppConfig = require('nordis').AppConfig;

process.env.sApp = 'apiary.js';

var sPath;
// Make sure the script is providing an absolute or relative path to the output directory.
process.argv.forEach(function (val, index, array) {
    switch (index) {
        case 2:
            sPath = val;
            break;
    }
});

AppConfig.writeApiaryDocs(sPath,function(err){
    if (err)
        AppConfig.error(err);

    AppConfig.exit();
});