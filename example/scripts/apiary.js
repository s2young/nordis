/**
 This script outputs apiary-compatible documentation for the api, based on what is provided in the config file.
 **/
var App     = require('./../../lib/AppConfig'),
    Base    = require('./../../lib/Base'),
    fs      = require('fs'),
    async   = require('async');

process.env.sApp = 'apiary.js';

var sPath;
// Make sure the script is providing an absolute or relative path to the output directory.
process.argv.forEach(function (val, index, array) {
    console.log(index+','+val);
    switch (index) {
        case 2:
            sPath = val;
            break;
    }
});

if (!sPath)
    throw new Error('No destination directory path provided. Please provide full, absolute path.');
else if (!fs.existsSync(sPath))
    throw new Error('Destination directory path provided does not exist. Please provide full, absolute path.');
else {

    fs.lstat( sPath, function (err, status) {
        if (err) {
            // file does not exist-
            if (err.code === 'ENOENT' )
                throw new Error('No file or directory at',sPath);
            else
                throw new Error(err);// miscellaneous error (e.g. permissions)

            App.exit();
        } else {
            if (status.isDirectory())
                sPath += '/apiary.apib';

            console.log('Beginning write of api docs at '+sPath);

            // Later, we'll create array of class names so we can process using async.forEach.
            var aClasses = [];

            async.series([
                function(callback) {
                    App.init(null,callback);
                }
                // Write top-level info about the API.
                ,function(callback) {
                    // Empty the file.
                    fs.writeFileSync(sPath,'');
                    // Write the first line.
                    fs.appendFileSync(sPath,'FORMAT: 1A\n');
                    // And the hostname for the api.
                    if (App.hApi && App.hApi.sHost)
                        fs.appendFileSync(sPath,'HOST: '+App.hApi.sHost+'\n\n');
                    // And the title for the api.
                    if (App.hApi && App.hApi.sTitle)
                        fs.appendFileSync(sPath,'# '+App.hApi.sTitle+'\n');
                    // And the description for the api.
                    if (App.hApi && App.hApi.sDescription)
                        fs.appendFileSync(sPath,App.hApi.sDescription+'\n\n');
                    callback();
                }
                // Write documentation for all the classes that have an hApi section in the conf file.
                ,function(callback) {
                    for (var sClass in App.hClasses) {
                        if (App.hClasses[sClass].hApi)
                            aClasses.push(sClass);
                    }
                    if (aClasses.length)
                        callback();
                    else
                        callback('No classes have an hApi section. Nothing to do.');
                }
                ,function(callback) {
                    async.forEach(aClasses,function(sClass,cback){
                        console.log(sClass+'...');

                        // Write class-level details.
                        fs.appendFileSync(sPath,'# Group '+sClass+'\n');
                        if (App.hClasses[sClass].hApi.sDescription)
                            fs.appendFileSync(sPath,App.hClasses[sClass].hApi.sDescription+'\n\n');

                        var aEndpoints = [];
                        // Create entries for each endpoint/path.
                        for (var sEndpoint in App.hClasses[sClass].hApi.hEndpoints) {
                            aEndpoints.push(sEndpoint);
                        }

                        if (aEndpoints.length)
                            async.forEach(aEndpoints,function(sEndpoint,cb) {
                                fs.appendFileSync(sPath,'## '+sClass+' ['+sEndpoint+']\n');
                                fs.appendFileSync(sPath,App.hClasses[sClass].hApi.hEndpoints[sEndpoint].sDescription+'\n\n');

                                if (App.hClasses[sClass].hApi.hEndpoints[sEndpoint].hParameters) {
                                    fs.appendFileSync(sPath,'+ Parameters\n');

                                    for (var sParam in App.hClasses[sClass].hApi.hEndpoints[sEndpoint].hParameters) {
                                        var hParam = App.hClasses[sClass].hApi.hEndpoints[sEndpoint].hParameters[sParam];
                                        fs.appendFileSync(sPath,'    + '+sParam+' (');
                                        if (hParam.bRequired)
                                            fs.appendFileSync(sPath,'required');
                                        else
                                            fs.appendFileSync(sPath,'optional');

                                        fs.appendFileSync(sPath,','+hParam.sType);
                                        fs.appendFileSync(sPath,',`'+hParam.sExample+'`) ... ');

                                        fs.appendFileSync(sPath,hParam.sDescription+'\n');
                                    }
                                    fs.appendFileSync(sPath,'\n');
                                }

                                if (App.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs) {
                                    for (var sVerb in App.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs) {
                                        var hVerb = App.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs[sVerb];
                                        fs.appendFileSync(sPath,'### '+hVerb.sTitle+' ['+sVerb+']\n');
                                        if (hVerb.sDescription)
                                            fs.appendFileSync(sPath,hVerb.sDescription+'\n');

                                        switch (sVerb) {
                                            case 'GET':case 'POST':
                                                fs.appendFileSync(sPath,'+ Response 200 (application/json)\n');
                                                fs.appendFileSync(sPath,'    + Body\n\n');

                                                // Assemble sample response from the class definittion.
                                                var oObj = Base.lookup({sClass:sClass});
                                                for (var sProp in App.hClasses[sClass].hProperties) {
                                                    oObj.set(sProp,App.hClasses[sClass].hProperties[sProp].sSample);
                                                }
                                                // Now, serialize with either the provided override or the default toHash method.
                                                var hResult = (hVerb.fnApiOutput) ? hVerb.fnApiOutput(oObj) : oObj.toHash();
                                                fs.appendFileSync(sPath,'            '+JSON.stringify(hResult)+'\n\n');

                                            break;
                                            case 'DELETE':
                                                fs.appendFileSync(sPath,'+ Response 204\n');
                                                break;
                                        }
                                        fs.appendFileSync(sPath,'\n');
                                    }
                                }
                                cb();
                            },cback);
                        else
                            cback();

                    },callback);
                }
            ],function(err){
                if (err)
                    App.error(err);

                App.exit();
            });
        }
    });
};