var async       = require('async'),
    fs          = require('fs'),
    Collection  = require('./../Collection'),
    Base        = require('./../Base'),
    Config      = require('./../AppConfig');

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
        apiPreparser(req,res,function(){
            async.series([
                function(cb) {
                    switch (req.method) {
                        case 'POST':
                            if (req.hNordis.oResult) {
                                req.hNordis.oResult.setData(req.body);
                                req.hNordis.oResult.save(cb);
                            } else
                                cb(Config.getError(500));
                            break;
                        case 'DELETE':
                            if (req.hNordis.oResult)
                                req.hNordis.oResult.delete(cb);
                            else
                                cb(Config.getError(500));
                            break;
                        default:
                            cb();
                            break;
                    }
                }
            ],function(err){
                if (err) {
                    Config.error(err);
                    res.status(500);
                    res.end(err);
                } else if (req.hNordis.hResult) {
                    Config.info(req.hNordis.hResult);
                    Config.info('END: '+req.hNordis.sPath+' ------');
                    res.end(JSON.stringify(req.hNordis.hResult));
                } else if (req.hNordis.oResult) {
                    req.hNordis.hResult = req.hNordis.oResult.toHash(req.hNordis.hExtras);
                    Config.info(req.hNordis.hResult);
                    Config.info('END: '+req.hNordis.sPath+' ------');
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
    if (!req.hNordis) req.hNordis = {};
    req.hNordis.sPath = req.path;
    if (options.path_filter)
        req.hNordis.sPath = req.hNordis.sPath.replace(options.path_filter,'');

    if (req.hNordis.sPath && req.hNordis.sPath != '/') {
        Config.info('START: '+req.method+' '+req.hNordis.sPath+' ------');
        if (Config.sLogLevel.match(/debug|silly/)) {
            if (req.query) Config.debug(JSON.stringify(req.query));
            if (req.body) Config.debug(JSON.stringify(req.body));
        }
        preParse(req,res,function(){
            Config.info('END: '+req.method+' '+req.hNordis.sPath+' ------');
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
var preParse = function(req,res,next) {
    // hExtras can be requested on GET or POST requests. if GET, the hExtras param must be a JSON string.
    if (req.query)
        for (var sProperty in req.query) {
            if ((req.query[sProperty] instanceof Object)===false && req.query[sProperty].match(/\{/))
                req.query[sProperty] = JSON.parse(req.query[sProperty]);
        }
    if (req.body || req.query)
        req.hNordis.hExtras = (req.method == 'POST' && req.body) ? req.body.hExtras : (req.query && req.query.hExtras) ? req.query.hExtras : null;

    console.log('req.query',req.query);
    // Parse the request path and figure out what is being requested. The path plus the req.method (POST, GET or DELETE) tell us where to look in the configuration file.
    // While parsing the path, we'll find the configuration settings for the API call.
    req.hNordis.hEndpoint;

    var aPaths = req.hNordis.sPath.split('/');
    if (!req.hNordis.sException && !req.hNordis.hException) {
        if (Config.hEndpointKeywords[aPaths[1]]) {
            var hMatch;
            for (var i = 0; i < Config.hEndpointKeywords[aPaths[1]].length; i++) {
                var hItem = Config.hEndpointKeywords[aPaths[1]][i];
                var aMatches;

                if (req.hNordis.sPath == hItem.sEndpoint) {
                    hMatch = hItem;
                    break;
                } else {
                    aMatches = req.hNordis.sPath.match(new RegExp('^' + hItem.sRegEx + '$'));
                    if (aMatches) {
                        hMatch = hItem;
                        // The class is the context, i.e. the class named before the variable.
                        hMatch.sApiClass = hItem.sClass;
                        hMatch.sClass = Config.getClassMap(aPaths[1]);
                        if (hMatch.sClass=='Stat') {
                            hMatch.sStat = Config.getClassMap(aPaths[2]);
                            hMatch.sGrain = aMatches[1];
                            delete hMatch.sApiClass;
                        }
                        // Make sure there isn't an exact match;
                        for (var n = 0; n < Config.hEndpointKeywords[aPaths[1]].length; n++) {
                            if (req.hNordis.sPath == Config.hEndpointKeywords[aPaths[1]][n].sEndpoint) {
                                hMatch = Config.hEndpointKeywords[aPaths[1]][n];
                                aMatches = null;
                            }
                        }
                        break;
                    }
                }
            }

            if (hMatch) {
                req.hNordis.sClass = hMatch.sClass;
                req.hNordis.sEndpoint = hMatch.sEndpoint;
                req.hNordis.hEndpoint = (Config.getClasses(hMatch.sApiClass||hMatch.sClass)) ? Config.getClasses(hMatch.sApiClass||hMatch.sClass).hApi.hEndpoints[hMatch.sEndpoint].hVerbs[req.method] : Config.hApi.hEndpoints[hMatch.sEndpoint].hVerbs[req.method];
                if (hMatch.sLookupProperty)
                    req.hNordis.sLookupProperty = hMatch.sLookupProperty;
                if (aMatches) {
                    req.hNordis.hQuery = {};
                    req.hNordis.hQuery[hMatch.sLookupProperty] = aMatches[1].toString();
                }
                if (req.hNordis.sClass == 'Stat') {
                    req.hNordis.hExtras = {};
                    req.hNordis.hExtras[hMatch.sStat] = {hExtras:{}};

                    Config.hStats[hMatch.sStat].aGrains.forEach(function(sGrain){
                        var hExtras = (req.query.hExtras && req.query.hExtras[sGrain]) ? req.query.hExtras[sGrain] : null;
                        if (hExtras || hMatch.sGrain == 'all') {
                            req.hNordis.hExtras[hMatch.sStat].hExtras[sGrain] = (sGrain != 'alltime') ? {
                                nMin:(hExtras && hExtras.nMin) ? hExtras.nMin : req.query.nMin
                                ,nMax:(hExtras && hExtras.nMax) ? hExtras.nMax : req.query.nMax
                                ,bReverse:(hExtras) ? hExtras.bReverse : req.query.bReverse
                                ,nSize:(hExtras) ? hExtras.nSize : req.query.nSize
                            } : true;
                        }
                    });

                }
            }
        }
    }

    var passItOn = function(err,hResult) {
        if (err) {
            Config.warn(err);
            if (err instanceof Object)
                req.hNordis.hException = err;
            else
                req.hNordis.sException = err.toString();
        }
        req.hNordis.hResult = hResult;
        next(err);
    };

    // If the class isn't found move on.
    if (!req.hNordis.sClass && !req.hNordis.hEndpoint) {
        passItOn();
    } else
        async.series([
            // If this is a stat-related request, load up the right app singleton. If you want to support multiple tenants
            // for stat tracking, you must have already loaded req.hNordis.oResult with the right app singleton. Do this in your express app with your own middleware
            // function that comes before the api parser middleware.
            function(cb) {
                if (req.hNordis.sClass == 'Stat' && !req.hNordis.oResult)
                    Base.loadAppSingleton('app',function(err,oApp){
                        if (!err)
                            req.hNordis.oResult = oApp;
                        cb(err);
                    });
                else
                    cb();
            }
            // Look up the root object. The hNordis hash will include both the sClass and hQuery needed to look up the object.
            ,function(cb) {
                if (req.hNordis.oResult)
                    cb();
                else if (req.hNordis.hQuery) {
                    Base.lookup({sClass:req.hNordis.sClass,hQuery:req.hNordis.hQuery},function(err,oResult){
                            req.hNordis.oResult = oResult;
                            cb(err);
                        });
                } else if (req.hNordis.sClass) {
                    req.hNordis.oResult = Base.lookup({sClass:req.hNordis.sClass});
                    cb();
                } else
                    cb();
            }
            // With the result, we then check for an api configuration for the path.
            // If not found, we just move on and skip the rest of the flow.
            ,function(cb){
                if (!req.hNordis.hEndpoint) {
                    cb('API call not configured: '+req.hNordis.sPath+'. Tried looking in configuration under class: \''+req.hNordis.sClass+'\' using method '+req.method+'.');
                } else {
                    Config.info(req.hNordis.sPath+' -- '+req.hNordis.sEndpoint);
                    cb();
                }
            }
            // Set properties on resource for POST requests, and execute fnApiCallProcessor override function if present in config.
            ,function(cb) {
                // Grab the requested version of the endpoint, if any.
                var fnApiCallProcessor = (options.version && req.hNordis.hEndpoint[options.version] && req.hNordis.hEndpoint[options.version].fnApiCallProcessor) ? req.hNordis.hEndpoint[options.version].fnApiCallProcessor : req.hNordis.hEndpoint.fnApiCallProcessor;
                if (fnApiCallProcessor) {
                    fnApiCallProcessor(req,Config,function(err,result){
                        // If the custom processor returns anything, we assume it's the hNordis.oResult;
                        if (result instanceof Base)
                            req.hNordis.oResult = result;
                        cb(err);
                    });
                } else {
                    if (req.method=='POST' && req.hNordis.sClass && req.hNordis.oResult) {
                        req.hNordis.oResult.setData(req.body);
                    }
                    cb();
                }
            }
            // Load extras if needed.
            // Before loading any extras, check to see if hResult has already been set or the endpoint configuration for an override boolean.
            ,function(cb){
                if (req.hNordis.hResult) {
                    Config.silly('req.hNordis.hResult found.');
                    cb();
                } else if (req.hNordis.oResult && req.hNordis.hExtras) {
                    Config.silly('loadExtras('+JSON.stringify(req.hNordis.hExtras)+')');
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
                if (req.hNordis.hResult)
                    cb();
                else {
                    var fnApiCallOutput = (options.version && req.hNordis.hEndpoint[options.version] && req.hNordis.hEndpoint[options.version].fnApiCallOutput) ? req.hNordis.hEndpoint[options.version].fnApiCallOutput : req.hNordis.hEndpoint.fnApiCallOutput;
                    if (fnApiCallOutput)
                        fnApiCallOutput(req,Config,function(err,hResult){
                            req.hNordis.hResult = hResult;
                            cb();
                        });
                    else if (!req.hNordis.oResult)
                        cb();
                    else {
                        req.hNordis.hResult = req.hNordis.oResult.toHash(req.hNordis.hExtras);
                        cb();
                    }
                }
            }
        ],function(err){
            // If the number of items in the series above changes, then the location of the hash result will also change.
            passItOn(err,req.hNordis.hResult);
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

        var sVersion = Config.sConfVersion||'';
        var current_version = '/_nordis_client_'+sVersion+'.js';
        var current_min_version = '/_nordis_client_'+sVersion+'.min.js';
        var min = req.path.match(/\.min\./);

        switch (req.path) {
            case '/_nordis_server/version':
                if (Config.NORDIS_ENV_ROOT_DIR) {
                    var hNordisInstance = require(Config.NORDIS_ENV_ROOT_DIR+'/node_modules/nordis/package.json');
                    res.end(hNordisInstance.version);
                } else {
                    res.end('NORDIS_ENV_ROOT_DIR is not set.');
                }
                break;
            case '/_nordis_client/version.txt':
                if (!sVersion) {
                    Config.warn('Your config file does not have an \'sConfVersion\' property defined. You must set and maintain this version in order to use the clientHelper middleware.');
                    res.end('');
                } else
                    res.end(sVersion);
                break;
            case '/_nordis_client/version.js':
                //res.writeHead(200, {'content-type':'text/javascript'});
                if (!sVersion) {
                    Config.warn('Your config file does not have an \'sConfVersion\' property defined. You must set and maintain this version in order to use the clientHelper middleware.');
                    res.end('define(function (require, exports, module) {exports.version = ""; exports.warning = "Your config file does not contain a version. Set and maintain the sConfVersion property to use this feature."});');
                } else
                    res.end('define(function (require, exports, module) {exports.version = "'+sVersion+'"});');
                break;
            case '/_nordis_client/version.nonamd.js':
                //res.writeHead(200, {'content-type':'text/javascript'});
                if (!sVersion) {
                    Config.warn('Your config file does not have an \'sConfVersion\' property defined. You must set and maintain this version in order to use the clientHelper middleware.');
                    res.end('window.nordis_conf=\'\'');
                } else
                    res.end('window.nordis_conf="'+sVersion+'";');
                break;

            case '/_nordis_client.js':
            case '/_nordis_client.min.js':
            case current_version:
            case current_min_version:
                // Return from memory unless the version has changed.
                res.writeHead(200, {'content-type':'text/javascript'});
                getClientJS(min,function(err,js){
                    if (min)
                        process.env[current_min_version] = js;
                    else
                        process.env[current_version] = js;

                    res.end(js);
                });
                break;
            default:
                next()
                break;
        }
    } else
        next();
};
/**
 * This method returns the client-side angular module containing the current model
 * and exposed api endpoints.
 * @param minified
 */
var getClientJS = function(opts,callback) {
    var Template = require('./Template');

    // Build the data to pass into template compiler, which will output custom js for the client.
    var hContext = {name:opts.name || 'nordis',hClasses:{},hApiCalls:{},hKeys:{},sMostCommonPrimaryKey:Config.sMostCommonPrimaryKey};

    // Figure out the classes that have exposed api calls, because we'll build factories.

    var append = function(hEndpoints,sClass) {
        var aCalls = [];
        for (var sEndpoint in hEndpoints) {
            if (hEndpoints[sEndpoint].hVerbs) {
                for (var sVerb in hEndpoints[sEndpoint].hVerbs) {
                    var hVerb = hEndpoints[sEndpoint].hVerbs[sVerb];
                    if (hVerb.sAlias) {
                        if (!sClass && hEndpoints[sEndpoint].sClass) sClass = hEndpoints[sEndpoint].sClass;
                        hVerb.sMethod = sVerb.toLowerCase();
                        hVerb.sEndpoint = sEndpoint;
                        aCalls.push(hVerb);
                    }
                }
            }
        }
        if (aCalls.length) {
            hContext.hApiCalls[sClass] = aCalls;
            if (Config.getClasses(sClass)) {
                hContext.hClasses[sClass] = Config.getClasses(sClass).hProperties;
                hContext.hKeys[sClass] = Config.getClasses(sClass).sKeyProperty;
            } else {
                hContext.hClasses[sClass] = {};
                hContext.hKeys[sClass] = null;
            }
        }
    };

    for (var sClass in Config.getClasses()) {
        if (Config.getClasses(sClass).hApi && Config.getClasses(sClass).hApi.hEndpoints) {
            append(Config.getClasses(sClass).hApi.hEndpoints,sClass);
        }
    }
    // Look in the root hApi for any endpoints that belong in this class.
    if (Config.hApi && Config.hApi.hEndpoints)
        append(Config.hApi.hEndpoints);

    var sLocalStorage = (opts.localStorage) ? '.localstorage' : '';
    Template.compile(__dirname+'/angular.nordis'+sLocalStorage+'.tpl',hContext,function(err,text){
        if (err)
            callback(err);
        else {
            if (opts.minify) {
                var UglifyJS = require('uglify-js');
                var result = UglifyJS.minify(text, {fromString: true,mangle:false});
                callback(null,result.code);
            } else
                callback(null,text);
        }
    });
};

var options = {};
var setOpts = function(opts) {
    options = opts;
};

module.exports = {
    apiParser:apiParser
    ,apiPreparser:apiPreparser
    ,clientHelper:clientHelper
    ,getClientJS:getClientJS
    ,setOpts:setOpts
};