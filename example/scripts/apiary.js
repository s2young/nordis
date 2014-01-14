/**
 This script outputs apiary-compatible documentation for the api, based on what is provided in the config file.
 **/
var AppConfig     = require('./../../lib/AppConfig'),
    Base    = require('./../../lib/Base'),
    Collection= require('./../../lib/Collection'),
    fs      = require('fs'),
    async   = require('async');

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

            AppConfig.exit();
        } else {
            if (status.isDirectory())
                sPath += '/apiary.apib';

            console.log('Beginning write of api docs at '+sPath);

            // Later, we'll create array of class names so we can process using async.forEach.
            var aClasses = [];

            async.series([
                function(callback) {
                    AppConfig.init(null,callback);
                }
                // Write top-level info about the API.
                ,function(callback) {
                    // Empty the file.
                    fs.writeFileSync(sPath,'');
                    // Write the first line.
                    fs.appendFileSync(sPath,'FORMAT: 1A\n');
                    // And the hostname for the api.
                    if (AppConfig.hApi && AppConfig.hApi.sHost)
                        fs.appendFileSync(sPath,'HOST: '+AppConfig.hApi.sHost+'\n\n');
                    // And the title for the api.
                    if (AppConfig.hApi && AppConfig.hApi.sTitle)
                        fs.appendFileSync(sPath,'# '+AppConfig.hApi.sTitle+'\n');
                    // And the description for the api.
                    if (AppConfig.hApi && AppConfig.hApi.sDescription)
                        fs.appendFileSync(sPath,AppConfig.hApi.sDescription+'\n\n');
                    callback();
                }
                // Write documentation for all the classes that have an hApi section in the conf file.
                ,function(callback) {
                    for (var sClass in AppConfig.hClasses) {
                        if (AppConfig.hClasses[sClass].hApi)
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
                        if (AppConfig.hClasses[sClass].hApi.sDescription)
                            fs.appendFileSync(sPath,AppConfig.hClasses[sClass].hApi.sDescription+'\n\n');

                        var aEndpoints = [];
                        // Create entries for each endpoint/path.
                        for (var sEndpoint in AppConfig.hClasses[sClass].hApi.hEndpoints) {
                            aEndpoints.push(sEndpoint);
                        }

                        if (aEndpoints.length)
                            async.forEach(aEndpoints,function(sEndpoint,cb) {
                                fs.appendFileSync(sPath,'## '+sClass+' ['+sEndpoint+']\n');
                                fs.appendFileSync(sPath,AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].sDescription+'\n\n');

                                if (AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].hParameters) {
                                    fs.appendFileSync(sPath,'+ Parameters\n');

                                    for (var sParam in AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].hParameters) {
                                        var hParam = AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].hParameters[sParam];
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

                                if (AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs) {
                                    for (var sVerb in AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs) {
                                        var hVerb = AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs[sVerb];
                                        fs.appendFileSync(sPath,'### '+hVerb.sTitle+' ['+sVerb+']\n');
                                        if (hVerb.sDescription)
                                            fs.appendFileSync(sPath,hVerb.sDescription+'\n');

                                        switch (sVerb) {
                                            case 'GET':case 'POST':
                                                fs.appendFileSync(sPath,'+ Response 200 (application/json)\n');
                                                fs.appendFileSync(sPath,'    + Body\n\n');

                                                // Build sample objects based on the sEndpoint. This is why we set an 'sSample' property in the class.property definitions.
                                                var oObj = Base.lookup({sClass:sClass});
                                                for (var sProp in AppConfig.hClasses[sClass].hProperties) {
                                                    oObj.set(sProp,AppConfig.hClasses[sClass].hProperties[sProp].sSample,true);
                                                }

                                                // Now, serialize with either the provided override or the default toHash method.
                                                if (hVerb.hSample)
                                                    fs.appendFileSync(sPath,'            '+JSON.stringify(hVerb.hSample)+'\n\n');
                                                else {
                                                    var hResult = oObj.toHash();
                                                    if (hVerb.fnApiCallOutput) {
                                                        if (!hVerb.fnApiCallOutput.toString().match(/return /))
                                                            throw new Error('To properly create Apiary docs, each fnApiCallOutput in your config file method should include a synchronous path with a return statement, and return sample data for documentation purposes.');
                                                        else {
                                                            hResult = hVerb.fnApiCallOutput({hNordis:{oResult:oObj}});
                                                        }
                                                    }
                                                    fs.appendFileSync(sPath,'            '+JSON.stringify(hResult)+'\n\n');
                                                }
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
                    AppConfig.error(err);

                AppConfig.exit();
            });
        }
    });
};