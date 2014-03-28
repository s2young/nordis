var async       = require('async'),
    fs          = require('fs'),
    AppConfig   = require('./../AppConfig'),
    Collection  = require('./../Collection'),
    Base        = require('./../Base');
/**
 * This boilerplate middleware parses API requests as defined in the config file, AND performs the CRUD operations
 * on the requested resources. This is mainly for evaluative, non-secure, boilerplate purposes. In production, you should
 * use preParser middleware, which prepares the resource (including setting properties on POST operations) but doesn't
 * actually save or delete anything.
 *
 * @param req
 * @param res
 * @param next
 */
var apiParser = function(req,res,next) {
    if (req.path && req.path != '/') {
        apiPreparser(req,res,function(err){
            async.series([
                function(cb) {
                    switch (req.method) {
                        case 'POST':
                            if (req.hNordis.oResult) {
                                req.hNordis.oResult.setData(req.body);
                                req.hNordis.oResult.save(cb);
                            } else
                                cb(AppConfig.getError(500));
                            break;
                        case 'DELETE':
                            if (req.hNordis.oResult)
                                req.hNordis.oResult.delete(cb);
                            else
                                cb(AppConfig.getError(500));
                            break;
                        default:
                            cb();
                            break;
                    }
                }
            ],function(err){
                if (err) {
                    AppConfig.error(err);
                    res.status(500);
                    res.end(err);
                } else if (req.hNordis.hResult) {
                    AppConfig.info(req.hNordis.hResult);
                    AppConfig.info('END: '+req.path+' ------');
                    res.end(JSON.stringify(req.hNordis.hResult));
                } else if (req.hNordis.oResult) {
                    req.hNordis.hResult = req.hNordis.oResult.toHash();
                    AppConfig.info(req.hNordis.hResult);
                    AppConfig.info('END: '+req.path+' ------');
                    res.end(JSON.stringify(req.hNordis.hResult));
                } else
                    res.end('');
            });
        });
    } else
        next();
};
/**
 * Use this method if you need to do any extra processing of the api request. This method performs retrieval, saving, etc
 * and places an oResult (a Base object) and an hResult (a hash/dictionary object ready to be serialized) on the request
 * for further processing by the app.
 *
 * @param req
 * @param res
 * @param next
 */
var apiPreparser = function(req,res,next){
    req.hNordis = {sPath:req.path};
    if (req.path && req.path != '/') {
        AppConfig.info('START: '+req.method+' '+req.path+' ------');
        preParse(req,res,function(){
            AppConfig.info('END: '+req.method+' '+req.path+' ------');
            next();
        });
    } else
        next();

};
/**
 * This method is shared by both apiPreparser and apiParser.
 * @param req
 * @param res
 * @param next
 */
var preParse = function(req,res,fnCallback) {
    // hExtras can be requested on GET or POST requests. if GET, the hExtras param must be a JSON string.
    if (req.body || req.query)
        req.hNordis.hExtras = (req.method=='POST' && req.body) ? req.body.hExtras : (req.query && req.query.hExtras) ? req.query.hExtras : null;

    // Parse the request path and figure out what is being requested. The path plus the req.method (POST, GET or DELETE) tell us where to look in the configuration file.
    // While parsing the path, we'll find the configuration settings for the API call.
    req.hNordis.hEndpoint;
    req.hNordis.sPath  = req.path;

    // We're going to keep a small array of the classes we check for a matching api endpoint (for informative errors).
    var aPaths = req.path.split('/');
    var aEndpoint = [];

    (function findPath(hMap,nIndex){

        var sPath = aPaths[nIndex].toLowerCase();
        var sProp;
        if (nIndex==1) req.hNordis.sClass = AppConfig.hClassMap[sPath.toLowerCase()];

        if (hMap[sPath]) {
            hMap = hMap[sPath];
            aEndpoint.push(sPath);
            if (!aPaths[nIndex+1]) {
                req.hNordis.sExtra = sPath;
                if (!req.hNordis.hExtras) {
                    req.hNordis.hExtras = {};
                    req.hNordis.hExtras[sPath] = true;
                }
            }
        } else if (nIndex > 1) {
            // This could be a variable, so we need to find the matching
            for (var sProp in hMap) {
                if (sProp.match(/^\{/)) {
                    aEndpoint.push(sProp);
                    // Handle stat-related endpoints.
                    if (sProp == '{grain}' && req.hNordis.sClass == 'Stat' && AppConfig.hClasses[aPaths[nIndex-1]]) {
                        AppConfig.oApp[aPaths[nIndex-1]] = Base.lookup({sClass:aPaths[nIndex-1],hData:AppConfig.hClasses[aPaths[nIndex-1]].hData});
                        req.hNordis.oResult = AppConfig.oApp[aPaths[nIndex-1]];
                        req.hNordis.sExtra = sPath;
                        req.hNordis.hExtras = {};
                        req.hNordis.hExtras[sPath] = {nMin:req.query.nMin,nMax:req.query.nMax};
                    } else {
                        req.hNordis.sLookupProperty = sProp.replace('{', '').replace('}', '');
                        req.hNordis.hQuery = {};
                        req.hNordis.hQuery[req.hNordis.sLookupProperty] = sPath.toString();
                    }
                    hMap = hMap[sProp]
                    break;
                }
            }
        }

        if (aPaths[nIndex+1]) {
            findPath(hMap, (nIndex + 1));
        } else if (hMap['/']){
            var sClass = hMap['/'];
            var sEndpoint = '/'+aEndpoint.join('/');

            if (AppConfig.hClasses[sClass].hApi && AppConfig.hClasses[sClass].hApi.hEndpoints && AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint] && AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs && AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs[req.method]) {
                req.hNordis.sPath = sEndpoint;
                req.hNordis.hEndpoint = AppConfig.hClasses[sClass].hApi.hEndpoints[sEndpoint].hVerbs[req.method];
            } else if (AppConfig.hApi && AppConfig.hApi.hEndpoints && AppConfig.hApi.hEndpoints[sEndpoint] && AppConfig.hApi.hEndpoints && AppConfig.hApi.hEndpoints[sEndpoint].hVerbs && AppConfig.hApi.hEndpoints && AppConfig.hApi.hEndpoints[sEndpoint].hVerbs[req.method]) {
                req.hNordis.sPath = sEndpoint;
                req.hNordis.sExtra = '';
                req.hNordis.hEndpoint = AppConfig.hApi.hEndpoints && AppConfig.hApi.hEndpoints[sEndpoint].hVerbs[req.method];
            }
        }

    })(AppConfig.hEndpointMap,1);


    var passItOn = function(err,hResult) {
        if (err) {
            AppConfig.warn(err);
            if (err instanceof Object)
                req.hNordis.hException = err;
            else
                req.hNordis.sException = err.toString();
        }
        AppConfig.silly(req.hNordis);

        req.hNordis.hResult = hResult;
        fnCallback(err);
    };

    // If the class isn't found move on.
    if (!req.hNordis.sClass && !req.hNordis.hEndpoint)
        passItOn();
    else
        async.series([
            // Look up the root object. The hNordis hash will include both the sClass and hQuery needed to look up the object.
            function(cb) {
                if (req.hNordis.oResult)
                    cb();
                else if (req.hNordis.hQuery)
                    Base.lookup({sClass:req.hNordis.sClass,hQuery:req.hNordis.hQuery},function(err,oResult){
                        req.hNordis.oResult = oResult;
                        cb(err);
                    });
                else if (req.hNordis.sClass) {
                    req.hNordis.oResult = Base.lookup({sClass:req.hNordis.sClass});
                    cb();
                } else
                    cb();
            }
            // With the result, we then check for an api configuration for the path.
            // If not found, we just move on and skip the rest of the flow.
            ,function(cb){
                if (req.hNordis.oResult)
                    AppConfig.debug('FOUND req.hNordis.oResult: '+req.hNordis.oResult.sClass+' ('+req.hNordis.oResult.getKey()+')');

                if (!req.hNordis.hEndpoint) {
                    cb('API call not configured: '+req.path+'. Tried looking in configuration under class: \''+req.hNordis.sClass+'\' using method '+req.method+'.');
                } else {
                    AppConfig.debug(req.hNordis.hEndpoint);
                    cb();
                }
            }
            // Set properties on resource for POST requests, and execute fnApiCallProcessor override function if present in config.
            ,function(cb) {
                if (req.hNordis.hEndpoint.fnApiCallProcessor) {
                    req.hNordis.hEndpoint.fnApiCallProcessor(req,AppConfig,function(err,result){
                        // If the custom processor returns anything, we assume it's the hNordis.oResult;
                        if (result instanceof Base)
                            req.hNordis.oResult = result;

                        cb(err);
                    });
                } else {
                    if (req.method=='POST' && req.hNordis.sClass && req.hNordis.oResult) {
                        AppConfig.debug('--- req.body ---');
                        AppConfig.debug(req.body);
                        req.hNordis.oResult.setData(req.body);
                    }
                    cb();
                }

            }
            // Load extras if needed.
            ,function(cb){
                // Before loading any extras, check the endpoint configuration for an override boolean.
                if (req.hNordis.oResult && req.hNordis.hExtras) {
                    AppConfig.debug('Loading Extras---');
                    req.hNordis.oResult.loadExtras(req.hNordis.hExtras,function(err){
                        if (err)
                            cb(err);
                        else {
                            if (req.hNordis.sExtra) {
                                req.hNordis.oResult = req.hNordis.oResult[req.hNordis.sExtra];
                                // The hExtras used for serialization starts at the sExtra:
                                if (req.hNordis.hExtras[req.hNordis.sExtra])
                                    req.hNordis.hExtras = req.hNordis.hExtras[req.hNordis.sExtra].hExtras || true;
                            }
                            cb();
                        }
                    });
                } else
                    cb();
            }
            // Allow user to customize API output (serialization) if desired using the 'fnApiCallOutput' function on the API call definition in config.
            ,function(cb) {
                if (req.hNordis.hEndpoint.fnApiCallOutput) {
                    req.hNordis.hEndpoint.fnApiCallOutput(req,AppConfig,cb);
                } else if (!req.hNordis.oResult) {
                    cb();
                } else {
                    cb(null,req.hNordis.oResult.toHash(req.hNordis.hExtras));
                }
            }
        ],function(err,aResult){
            // If the number of items in the series above changes, then the location of the hash result will also change.
            passItOn(err,aResult[4]);
        });
};
/**
 * This is a single-endpoint handler for apps requesting what version the app is running.
 * This handler pulls the requested version from the packgage.json or the conf.js.
 * @param req
 * @param res
 * @param next
 */
var clientHelper = function(req,res,next) {
    if (req.path.match(/\/_nordis_/)) {

        var sVersion = AppConfig.sConfVersion||'';
        var current_version = '/_nordis_client_'+sVersion+'.js';

        switch (req.path) {
            case '/_nordis_server/version':
                if (process.env.NORDIS_ENV_ROOT_DIR) {
                    var hNordisInstance = require(process.env.NORDIS_ENV_ROOT_DIR+'/node_modules/nordis/package.json');
                    res.end(hNordisInstance.version);
                } else {
                    res.end('NORDIS_ENV_ROOT_DIR is not set.');
                }
                break;
            case '/_nordis_client/version.txt':
                if (!sVersion) {
                    AppConfig.warn('Your config file does not have an \'sConfVersion\' property defined. You must set and maintain this version in order to use the clientHelper middleware.');
                    res.end('');
                } else
                    res.end(sVersion);
                break;
            case '/_nordis_client/version.js':
                //res.writeHead(200, {'content-type':'text/javascript'});
                if (!sVersion) {
                    AppConfig.warn('Your config file does not have an \'sConfVersion\' property defined. You must set and maintain this version in order to use the clientHelper middleware.');
                    res.end('define(function (require, exports, module) {exports.version = ""; exports.warning = "Your config file does not contain a version. Set and maintain the sConfVersion property to use this feature."});');
                } else
                    res.end('define(function (require, exports, module) {exports.version = "'+sVersion+'"});');
                break;
            case '/_nordis_client.js':
            case '/_nordis_client.min.js':
            case current_version:
            case current_version.replace('.js','.min.js'):
                // Return from memory unless the version has changed.
                if (process.env[current_version])
                    res.end(process.env[current_version]);
                else {
                    var Template = require('./Template');

                    // Build the data to pass into template compiler, which will output custom js for the client.
                    var hContext = {hClasses:{},hApiCalls:{},hKeys:{}};
                    hContext.aAngularMods = (AppConfig.aAngularMods) ? JSON.stringify(AppConfig.aAngularMods) : [];
                    hContext.sNordisHost = AppConfig.sNordisHost || '';

                    // Figure out the classes that have exposed api calls, because we'll build factories.
                    for (var sClass in AppConfig.hClasses) {
                        var aCalls = [];

                        var append = function(hEndpoints,bInternal) {
                            for (var sEndpoint in hEndpoints) {
                                if (hEndpoints[sEndpoint].hVerbs)
                                    for (var sVerb in hEndpoints[sEndpoint].hVerbs) {
                                        var hVerb = hEndpoints[sEndpoint].hVerbs[sVerb];
                                        if (hVerb.sAlias && (bInternal || sClass == hEndpoints[sEndpoint].sClass)) {
                                            hVerb.sMethod = sVerb.toLowerCase();
                                            hVerb.sEndpoint = sEndpoint;
                                            aCalls.push(hVerb);
                                        }
                                    }
                            }
                        }

                        if (AppConfig.hClasses[sClass].hApi && AppConfig.hClasses[sClass].hApi.hEndpoints) {
                            append(AppConfig.hClasses[sClass].hApi.hEndpoints,true);
                        }
                        // Look in the root hApi for any endpoints that belong in this class.
                        if (AppConfig.hApi && AppConfig.hApi.hEndpoints) {
                            append(AppConfig.hApi.hEndpoints);
                        }
                        if (aCalls.length) {
                            hContext.hClasses[sClass] = AppConfig.hClasses[sClass].hProperties;
                            hContext.hApiCalls[sClass] = aCalls;
                            hContext.hKeys[sClass] = AppConfig.hClasses[sClass].sKeyProperty;
                        }
                    }

                    Template.compile(__dirname+'/angular.nordis.tpl',hContext,function(err,text){
                        if (err)
                            AppConfig.error(err);
                        else {
                            if (req.path.match(/\.min/)) {
                                var UglifyJS = require('uglify-js');
                                var result = UglifyJS.minify(text, {fromString: true,mangle:false});
                                process.env[current_version] = result.code;
                            } else {
                                process.env[current_version] = text;
                            }

                            AppConfig.debug(process.env[current_version]);
                            //res.writeHead(200, {'content-type':'text/javascript'});
                            res.end(process.env[current_version]);
                        }
                    });
                }
                break;
            default:
                next()
                break;
        }
    } else
        next();
}

module.exports = {
    apiParser:apiParser
    ,apiPreparser:apiPreparser
    ,clientHelper:clientHelper
};