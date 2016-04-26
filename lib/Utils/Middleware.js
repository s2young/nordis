var async       = require('async'),
    fs          = require('fs'),
    Collection  = require('./../Collection'),
    Base        = require('./../Base'),
    Metric      = require('./../Metric'),
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
                    res.status(500).send(err);
                } else if (req.hNordis.hResult) {
                    Config.info('pre-END 1: '+req.hNordis.sPath+' ------');
                    res.end(JSON.stringify(req.hNordis.hResult));
                    Config.info('END: '+req.hNordis.sPath+' ------');
                } else if (req.hNordis.oResult) {
                    Config.info('pre-END 2: '+req.hNordis.sPath+' ------');
                    req.hNordis.hResult = req.hNordis.oResult.toHash(req.hNordis.hExtras,req.hNordis.bPrivate);
                    res.end(JSON.stringify(req.hNordis.hResult));
                    Config.info('END: '+req.hNordis.sPath+' ------');
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

    req.hNordis.nStart = new Date().getTime();
    if (req.hNordis.sPath && req.hNordis.sPath != '/') {
        Config.info('START: '+req.method+' '+req.hNordis.sPath+' ------');
        preParse(req,res,next);
    } else
        next();
};
/**
 * Called at the end of the api request chain to make sure we can close the entire request loop and identify
 * any problems in the chain if they exist.
 * @param req
 * @param res
 */
var apiRender = function(req,res) {
    if (req.hNordis.sException) req.hNordis.hException = {nType:0,sMessage:req.hNordis.sException};
    if (req.hNordis.hException) {
        req.hNordis.hException.path = req.path;
        req.hNordis.hException.sUserAgent = req.headers['user-agent'];
        if (req.hNordis.hException.nType==undefined) Config.error(req.hNordis.hException);
        res.status(500).json(req.hNordis.hException);
    } else {
        res.statusCode = 200;
        if (req.hNordis.hResult && (req.hNordis.hResult instanceof Object)) {
            Config.info('pre-END 3: '+req.hNordis.sPath+' ------');
            res.json(req.hNordis.hResult);
        } else {
            Config.info('pre-END 4: '+req.hNordis.sPath+' ------');
            res.send(req.hNordis.hResult);
        }
    }
    Config.info('END: '+req.method+' '+req.hNordis.sPath+' ------ '+((new Date().getTime())-req.hNordis.nStart)+' MS');

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

    // Parse the request path and figure out what is being requested. The path plus the req.method (POST, GET or DELETE) tell us where to look in the configuration file.
    // While parsing the path, we'll find the configuration settings for the API call.
    req.hNordis.hEndpoint;
    //if (Config.sLogLevel.match(/(silly|debug)/)) {
    //    if (!Config.hRequests) Config.hRequests = {};
    //    req.hNordis.sTimestamp = new Date().getTime();
    //    Config.hRequests[req.hNordis.sTimestamp] = {};
    //}

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
                } else if (hItem.sRegEx) {
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
            if (hMatch && hMatch.bMetric) {
                req.hNordis.sClass = hMatch.sClass;
                req.hNordis.sEndpoint = hMatch.sEndpoint;
                req.hNordis.sFilter = req.query.sFilter;
                req.hNordis.sName = hMatch.sName;
                req.hNordis.bMetric = true;
                if (req.query.hMetrics) req.hNordis.hExtras = req.query.hMetrics;
            } else if (hMatch) {
                req.hNordis.sClass = hMatch.sClass;
                req.hNordis.sEndpoint = hMatch.sEndpoint;
                req.hNordis.hEndpoint = (Config.getClasses(hMatch.sApiClass||hMatch.sClass) && Config.getClasses(hMatch.sApiClass||hMatch.sClass).hApi) ? Config.getClasses(hMatch.sApiClass||hMatch.sClass).hApi.hEndpoints[hMatch.sEndpoint].hVerbs[req.method] : Config.hApi.hEndpoints[hMatch.sEndpoint].hVerbs[req.method];
                if (hMatch.sLookupProperty)
                    req.hNordis.sLookupProperty = hMatch.sLookupProperty;
                if (aMatches) {
                    req.hNordis.hQuery = {};
                    req.hNordis.hQuery[hMatch.sLookupProperty] = aMatches[1].toString();
                }
            }
        }
    }

    var passItOn = function(err) {
        if (err) {
            Config.warn(err);
            if (err instanceof Object)
                req.hNordis.hException = err;
            else
                req.hNordis.sException = err.toString();
        }
        next();
    };


    // If the class isn't found move on.
    if (!req.hNordis.sClass && !req.hNordis.hEndpoint && !req.hNordis.bMetric) {
        passItOn();
    } else
        async.series([
            // If this is a stat-related request, load up the right app singleton. If you want to support multiple tenants
            // for stat tracking, you must have already loaded req.hNordis.oResult with the right app singleton. Do this in your express app with your own middleware
            // function that comes before the api parser middleware.
            function(cb) {
                //Config.debug('preParse 1: '+req.hNordis.sPath);
                if (req.hNordis.oResult || req.hNordis.bMetric || !req.hNordis.sClass || !Config.hClasses[req.hNordis.sClass]) {
                    //Config.debug('preParse 1a: ',(!req.hNordis.oResult) ? req.hNordis.sPath : req.hNordis.oResult.sClass+' ('+req.hNordis.oResult.getKey()+')');
                    cb();
                } else if (req.hNordis.hQuery && Object.keys(req.hNordis.hQuery) && Object.keys(req.hNordis.hQuery).length) {
                    //Config.debug('preParse 1b: ',req.hNordis.hQuery);
                    Base.lookup({sClass:req.hNordis.sClass,hQuery:req.hNordis.hQuery,_Tenant:(req.hNordis.oTenant) ? req.hNordis.oTenant.getKey() : null},function(err,oResult){
                            req.hNordis.oResult = oResult;
                            cb(err);
                        });
                } else {
                    //Config.debug('preParse 1c: ',req.hNordis.sClass);
                    req.hNordis.oResult = Base.lookup({sClass:req.hNordis.sClass,_Tenant:(req.hNordis.oTenant) ? req.hNordis.oTenant.getKey() : null});
                    cb();
                }
            }
            // With the result, we then check for an api configuration for the path.
            // If not found, we just move on and skip the rest of the flow.
            ,function(cb){
                //Config.debug('preParse 2: '+req.hNordis.sPath);
                if (!req.hNordis.hEndpoint && !req.hNordis.bMetric) {
                    cb('API call not configured: '+req.hNordis.sPath+'. Tried looking in configuration under class: \''+req.hNordis.sClass+'\' using method '+req.method+'.');
                } else
                    cb();
            }
            // Set properties on resource for POST requests, and execute fnApiCallProcessor override function if present in config.
            ,function(cb) {
                //Config.debug('preParse 3: '+req.hNordis.sPath);
                // Grab the requested version of the endpoint, if any.
                var fnApiCallProcessor = (options.version && req.hNordis.hEndpoint && req.hNordis.hEndpoint[options.version] && req.hNordis.hEndpoint[options.version].fnApiCallProcessor) ? req.hNordis.hEndpoint[options.version].fnApiCallProcessor : (req.hNordis.hEndpoint) ? req.hNordis.hEndpoint.fnApiCallProcessor : null;
                if (fnApiCallProcessor)
                    fnApiCallProcessor(req,Config,function(err,result){
                        // If the custom processor returns anything, we assume it's the hNordis.oResult;
                        if (result && result instanceof Base) req.hNordis.oResult = result;
                        cb(err);
                    });
                else
                    cb();
            }
            // Load extras if needed.
            // Before loading any extras, check to see if hResult has already been set or the endpoint configuration for an override boolean.
            ,function(cb){
                //Config.debug('preParse 4: '+req.hNordis.sPath);
                if (req.hNordis.hResult) {
                    //Config.debug('preParse 4a: '+req.hNordis.sPath);
                    cb();
                } else if (req.hNordis.oResult && req.hNordis.hExtras) {

                    Config.debug('preParse 4b: '+req.hNordis.sPath,JSON.stringify(req.hNordis.hExtras));
                    req.hNordis.oResult.loadExtras(req.hNordis.hExtras,function(err) {
                        Config.debug('preParse 4b-1: '+req.hNordis.sPath);
                        if (err) {
                            console.error(err);
                            cb(err);
                        } else {
                            //Config.debug('preParse 4b-2: '+req.hNordis.sPath);
                            if (req.hNordis.sExtra && req.hNordis.oResult[req.hNordis.sExtra]) {
                                req.hNordis.oResult = req.hNordis.oResult[req.hNordis.sExtra];
                                // The hExtras used for serialization starts at the sExtra:
                                if (req.hNordis.hExtras[req.hNordis.sExtra])
                                    req.hNordis.hExtras = req.hNordis.hExtras[req.hNordis.sExtra].hExtras || true;
                            }
                            //Config.debug('preParse 4b-3: '+req.hNordis.sPath);
                            cb();
                        }
                    });
                } else if (req.hNordis.bMetric) {

                    //Config.debug('preParse 4e: '+req.hNordis.sPath);
                    Metric.lookup({sClass:req.hNordis.sClass,sName:req.hNordis.sName,nMin:req.query.nMin,nMax:req.query.nMax,sFilter:req.hNordis.sFilter,hMetrics:req.hNordis.hExtras},function(err,oStat){
                        req.hNordis.hResult = {};
                        if (oStat && req.hNordis.hExtras) {
                            for (var sMetric in req.hNordis.hExtras) {
                                req.hNordis.hResult[sMetric] = {};
                                for (var sGrain in req.hNordis.hExtras[sMetric]) {
                                    if (oStat[sMetric] && oStat[sMetric][sGrain] && oStat[sMetric][sGrain] instanceof Base)
                                        req.hNordis.hResult[sMetric][sGrain] = oStat[sMetric][sGrain].toHash(req.hNordis.hExtras[sMetric][sGrain]);
                                    else if (oStat[sMetric])
                                        req.hNordis.hResult[sMetric][sGrain] = oStat[sMetric][sGrain];
                                }
                            }
                        }
                        cb(err);
                    });

                } else {
                    //Config.debug('preParse 4f: '+req.hNordis.sPath);
                    cb();
                }

            }
            // Allow user to customize API output (serialization) if desired using the 'fnApiCallOutput' function on the API call definition in config.
            ,function(cb) {
                //Config.debug('preParse 6: '+req.hNordis.sPath);
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
                        req.hNordis.hResult = req.hNordis.oResult.toHash(req.hNordis.hExtras,req.hNordis.bPrivate);
                        cb();
                    }
                }
            }
        ],function(err){
            //Config.debug('preParse DONE: '+req.hNordis.sPath);
            //if (Config.sLogLevel.match(/(silly|debug)/))
            //    Config.hRequests[req.hNordis.sTimestamp] = req.hNordis.sPath;

            // If the number of items in the series above changes, then the location of the hash result will also change.
            passItOn(err);
        });
};
/**
 * Middleware to establish the tenant and user making the api request.
 * @type {{}}
 */
var setApiTenant = function(middlewareFn) {
    return function(req,res,next) {
        if (!req.hNordis) req.hNordis = {};
        middlewareFn(req,res,next);
    };
};

var options = {};
var setOpts = function(opts)
{
    options = opts;
};

module.exports = {
    apiParser:apiParser
    ,apiPreparser:apiPreparser
    ,apiRender:apiRender
    ,setApiTenant:setApiTenant
    ,setOpts:setOpts
};