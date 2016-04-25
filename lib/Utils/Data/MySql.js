var mysql       = require('mysql2'),
    async       = require('async'),
    Str         = require('./../String');

var Config;
var Base;
var Collection;

function MySql() {}
var p = MySql.prototype;
/**
 * MySql singleton initialization method. Using the passed-in params, which can
 * be stored in your configuration file, we define the connection params for your
 * MySql server as well as desired size of the connection pool. This method also
 * creates a couple essential framework tables that powers sorted sets and foreign key lookups.
 * @param hOpts
 */
p.init = function(hOpts) {
    // Create a 'default' db alias if none is provided in config.
    if (hOpts.sSchema)
        hOpts = {default:hOpts};
    this.hOpts = hOpts;
    this.dbPool = {};
};
p.end = function(fnCallback){
    var oSelf = this;
    if (oSelf.dbPool)
        Object.keys(oSelf.dbPool).forEach(function(sDbAlias){
            oSelf.dbPool[sDbAlias].end(function(){});
        });
    if (fnCallback) fnCallback();
};
var createPool = function(hOpts) {
    if (!Config) {
        Base = require('./../../Base');
        Config = require('./../../AppConfig');
    }
    return mysql.createPool({
        connectionLimit : hOpts.nMaxConnections,
        connectTimeout  : hOpts.connectTimeout || null,
        acquireTimeout  : hOpts.acquireTimeout || 10000,
        host            : hOpts.sHost,
        user            : hOpts.sUser,
        port            : hOpts.nPort||3306,
        password        : hOpts.sPass,
        database        : hOpts.sSchema,
        supportBigNumbers:true,
        multipleStatements: true
    });
};
/**
 * Connection pool acquisition.
 * @param fnCallback
 * @param sDbAlias
 * @param sTrace
 */
p.acquire = function(fnCallback,sDbAlias) {
    var oSelf = this;
    sDbAlias = (oSelf.hOpts[sDbAlias]) ? sDbAlias : 'default';
    if (!oSelf.dbPool[sDbAlias]) {
        if (oSelf.hOpts[sDbAlias]) console.log('CREATING POOL `'+sDbAlias+'` with max connections of '+oSelf.hOpts[sDbAlias].nMaxConnections);
        oSelf.dbPool[sDbAlias] = createPool(oSelf.hOpts[sDbAlias],sDbAlias);
        oSelf.dbPool[sDbAlias].on('error',function(err){
            console.log('ENDING POOL `'+sDbAlias+'`',err);
            if (oSelf.dbPool && oSelf.dbPool[sDbAlias]) {
                try {
                    oSelf.dbPool[sDbAlias].end();
                } catch (er) {
                }
            }
            delete oSelf.dbPool[sDbAlias];
        });
    }
    //fnCallback(oSelf.dbPool[sDbAlias]);
    oSelf.dbPool[sDbAlias].getConnection(function(err,oClient){
        if (err) {
            oSelf.release(oClient);
            fnCallback(err);
        } else {
            oClient.sDbAlias = sDbAlias;
            fnCallback(null,oClient);
        }
    });
};
/**
 * Common release method just for consistency with acquire. Also helpful with debugging.
 * @param oClient
  */
p.release = function(oClient) {
    if (oClient)  oClient.release();
};
/**
 * All callbacks pass through here to make sure we release our connection properly.
 * @param err
 * @param oObj
 * @param fnCallback
 */
p.dispatchResult = function(err,oObj,fnCallback) {
    if (err) Config.error(err);
    if (fnCallback) fnCallback(err,oObj);
};
/**
 * This method loads an object using the passed-in hQuery, which must be a single name-value
 * pair using either the primary key or a valid secondary lookup field.
 * @param hOpts
 * @param oObj
 * @param fnCallback
 */
p.loadObject = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    var sKeyProperty = oObj.getSettings().sKeyProperty;
    var sDbAlias = (oSelf.hOpts[oObj.getSettings().sDbAlias]) ? oObj.getSettings().sDbAlias : 'default';
    var bSkip = (!sKeyProperty||oSelf.hOpts[sDbAlias].bSkip||oObj.getKey());
    var oClient,sStatement;

    async.series([
        // If the settings call for skipping MySql, or if the object is already loaded, we'll just call back.
        // Otherwise, we check for a db connection and create one if needed.
        function(callback){
            if (bSkip)
                callback();
            else {
                oSelf.acquire(function(err,oResult){
                    if (err) oSelf.release(oResult);

                    oClient = oResult;
                    callback(err);
                },sDbAlias);
            }
        }
        // Do the lookup if needed.
        ,function(callback) {
            if (oClient && !bSkip) {
                // First get the object itself.

                var hQuery = oSelf.generateQuery(hOpts.hQuery,oObj,hOpts.sView);

                if (!hQuery || !hQuery.aStatements.length)
                    callback();
                else {
                    Config.debug(hQuery.aStatements,hQuery.aValues);

                    sStatement = hQuery.aStatements.join(';');
                    oClient.query(sStatement,hQuery.aValues,function(err,aResults){
                        oSelf.release(oClient)
                        if (err) {
                            delete oObj.sSource;
                            oSelf._handleDbError(err,oObj,sDbAlias,callback,'loadObject',[hOpts,oObj,callback]);

                        } else if (aResults && aResults[0]) {
                            oObj.hData = aResults[0];
                            oObj.sSource = 'MySql';
                            callback();
                        } else {
                            // If we used a secondary lookup field, then let's just try looking in that field directly.
                            // This is less performant, especially if the column isn't properly indexed. But we shouldn't
                            // fail just because the _CrossRef table is messed up. Fix that too, if we find something.
                            if (hQuery.sLookupField) {
                                oSelf.loadObjectBySecondary(hQuery,oObj,sDbAlias,callback);
                            } else
                                callback(err,oObj);
                        }
                    });

                }
            } else
                callback();
        }
    ],function(err){
        oSelf.dispatchResult(err,oObj,fnCallback);
    });
};
/**
 * If a secondary key lookup fails, we look directly into the object table for the secondary field.  This also
 * updates the _CrossReferenceTbl so the failure doesn't happen again.
 * @param hQuery
 * @param oObj
 * @param sDbAlias
 * @param fnCallback
 */
p.loadObjectBySecondary = function(hQuery,oObj,sDbAlias,fnCallback){
    var oSelf = this;
    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';
    var sSql = 'SELECT * FROM '+sTable+' WHERE '+hQuery.sLookupField+'=?;';

    Config.silly(sSql);
    Config.silly(hQuery.aLookupValue);

    oSelf.acquire(function(err,oClient){
        if (err) {
            oSelf.release(oClient);
            fnCallback(err);
        } else
            oClient.query(sSql,hQuery.aLookupValue,function(err,aRes){
                oSelf.release(oClient)
                if (err)
                    oSelf._handleDbError(err,oObj,sDbAlias,fnCallback,'loadObjectBySecondary',[hQuery,oObj,sDbAlias,fnCallback]);
                else if (aRes && aRes[0]) {
                    oObj.hData = aRes[0];
                    oObj.sSource = 'MySql';
                    oSelf._updateCrossRef(hQuery,oObj,sDbAlias,fnCallback);
                } else
                    fnCallback(null,oObj);
            });

    },sDbAlias);
};

p._updateCrossRef = function(hQuery,oObj,sDbAlias,fnCallback) {
    var oSelf = this;
    // Update the cross-ref table so this doesn't happen again.
    oSelf.acquire(function(err,oClient){
        if (err) {
            oSelf.release(oClient);
            fnCallback(err);
        } else
            oClient.query('INSERT INTO _CrossReferenceTbl (sID,RefID) VALUES (?,?) ON DUPLICATE KEY UPDATE RefID=?',[oObj.getRedisKey(oObj.get(hQuery.sLookupField)),oObj.getKey().toString(),oObj.getKey().toString()],function(err){
                oSelf.release(oClient)
                if (err)
                    oSelf._handleDbError(err,oObj,sDbAlias,fnCallback,'_updateCrossRef',[hQuery,oObj,sDbAlias,fnCallback]);
                else
                    fnCallback(null,oObj);
            });
    },sDbAlias)

};
/**
 * This method generates a parameterized query for the passed-in object and query.
 * @param hQuery
 * @param oObj
 * @param sView
 * @returns {{aStatements: Array, aValues: Array}}
 */
p.generateQuery = function(hQuery,oObj,sView) {
    if (!hQuery) {
        return;
    } else {
        var hResult = {aStatements:[],aValues:[]};
        var sTable = sView||oObj.getSettings().sTable||oObj.sClass+'Tbl';
        if (hQuery.aStatements) {
            hResult.aStatements = hQuery.aStatements;
            hResult.aValues = hQuery.aValues;
        } else if (hQuery.sWhere) {
            hResult.aStatements.push('SELECT * FROM '+sTable+' WHERE '+hQuery.sWhere);
        } else {
            // Secondary lookup, which is just a pointer to the primary key.
            var aLookups = [];var aParams = []; var aVals = []; var aCrossRefVals = [];

            for (var sLookup in hQuery) {
                if (oObj.getSettings().hProperties[sLookup]) {
                    aLookups.push(sLookup);

                    switch (hQuery[sLookup]) {
                        case null:case 'NULL':case 'null':
                            aParams.push(sLookup+' IS NULL');
                            break;
                        case 'IS NOT NULL':case 'NOT NULL':
                            aParams.push(sLookup+' IS NOT NULL');
                            break;
                        default:
                            aParams.push(sLookup+'=?');
                            aVals.push(hQuery[sLookup]);
                            break;
                    }

                    if (sLookup != oObj.getSettings().sKeyProperty
                        && (oObj.getSettings().hProperties[sLookup].bUnique||oObj.getSettings().hProperties[sLookup].bPrimary)
                        && Object.keys(hQuery).length==1)
                    {
                        aCrossRefVals.push(oObj.getRedisKey(hQuery[sLookup]));
                        if (aCrossRefVals.length == 1) {
                            hResult.sLookupField = sLookup;
                            hResult.aLookupValue = [hQuery[sLookup]];
                        }
                    }
                } else
                    Config.warn('Attempting to lookup using a property ('+sLookup+') that does not exist on this class ('+oObj.sClass+')');
            }

            // Query syntax depends on whether we're doing a single, secondary key lookup or a multi-parameter query.
            if (aParams.length > 1 || !aCrossRefVals.length) {
                hResult.aStatements.push('SELECT * FROM '+sTable+' WHERE '+aParams.join(' AND '));
                hResult.aValues = aVals;
            } else if (aCrossRefVals.length) {
                hResult.aStatements.push('SELECT * FROM '+sTable+' WHERE '+oObj.getSettings().sKeyProperty+' = (SELECT RefID FROM _CrossReferenceTbl WHERE sID = ?)');
                hResult.aValues = aCrossRefVals;
            }
        }

        return hResult;
    }

};
/**
 * Populates a collection from MySql.
 * @param hOpts
 * @param cColl
 * @param fnCallback
 */
p.loadCollection = function(hOpts,cColl,fnCallback) {
    var oSelf = this;

    if (!Config) {
        Base = require('./../../Base');
        Config = require('./../../AppConfig');
    }

    var sKeyProperty = Config.getClasses(cColl.sClass).sKeyProperty;
    var sDbAlias = (oSelf.hOpts[Config.getClasses(cColl.sClass).sDbAlias]) ? Config.hClasses[cColl.sClass].sDbAlias : 'default';
    var oClient,sStatement;

    if (!hOpts.hQuery) {
        oSelf.dispatchResult(null,cColl,fnCallback);
    } else
        async.waterfall([
            function(callback){
                oSelf.acquire(function(err,oResult){
                    if (err) oSelf.release(oResult);
                    callback(err,oResult);
                }, sDbAlias);
            }
            ,function(oResult,callback){
                oClient = oResult;
                // Pass down all the configuration options required to construct the collection appropriately.
                hOpts.nSize = hOpts.nSize || 0;
                hOpts.sFirstID = hOpts.sFirstID || null;
                hOpts.sOrderBy = hOpts.sOrderBy||sKeyProperty;
                hOpts.sGroupBy = hOpts.sGroupBy || null;
                hOpts.bReverse = hOpts.bReverse || false;
                hOpts.nMin = hOpts.nMin || null;
                hOpts.nMax = hOpts.nMax || null;

                var aValues = (hOpts.hQuery && hOpts.hQuery.aValues) ? hOpts.hQuery.aValues : [];
                var aStatements = [];

                var sWhere = '';
                if (hOpts.hQuery && hOpts.hQuery.aStatements) {

                    sWhere = ' WHERE ';
                    hOpts.hQuery.aStatements.forEach(function(item){
                        sWhere += ' '+item;
                    });

                } else if (hOpts.hQuery && hOpts.hQuery.sWhere != undefined) {
                    if (hOpts.hQuery.sWhere)
                        sWhere = ' WHERE '+hOpts.hQuery.sWhere;
                } else if (hOpts.hQuery) {
                    var aParms = [];
                    for (var sProp in hOpts.hQuery) {
                        switch (hOpts.hQuery[sProp]) {
                            case null:case 'NULL':case 'null':case 'is null':case 'IS NULL':
                            aParms.push(sProp+' IS NULL');
                            break;
                            case 'IS NOT NULL':case 'NOT NULL':
                            aParms.push(sProp+' IS NOT NULL');
                            break;
                            default:
                                aParms.push(sProp+'=?');
                                aValues.push(hOpts.hQuery[sProp]);
                                break;
                        }
                    }
                    sWhere = ' WHERE '+aParms.join(' AND ');
                }

                var sLimit = (hOpts.nSize && isNaN(hOpts.nSize)===false) ? ' LIMIT 0, ' + (Number(hOpts.nSize)+1) : '';
                var sOrderBy = (hOpts.sOrderBy) ? (hOpts.bReverse) ? ' ORDER BY '+hOpts.sOrderBy+' DESC' : ' ORDER BY '+hOpts.sOrderBy+' ASC': '';
                var sGroupBy = (hOpts.sGroupBy) ? ' GROUP BY '+hOpts.sGroupBy : '';
                var sMin = (hOpts.nMin && isNaN(hOpts.nMin)===false) ? ' AND '+hOpts.sOrderBy+' >= '+hOpts.nMin : '';
                var sMax = (hOpts.nMax && isNaN(hOpts.nMax)===false) ? ' AND '+hOpts.sOrderBy+' <= '+hOpts.nMax : '';

                // If you have a custom view or table name you can pass it in here:
                var sTbl = hOpts.sView||Config.getClasses(cColl.sClass).sTable||cColl.sClass+'Tbl';

                if (sGroupBy)
                    aStatements.push('SELECT COUNT(*) AS nTotal FROM (SELECT * FROM '+sTbl+sWhere+sMin+sMax+sGroupBy+') sub');
                else
                    aStatements.push('SELECT COUNT(*) AS nTotal FROM '+sTbl+sWhere+sMin+sMax);

                // If sFirstID is passed in, it means that we should start there. The direction we go from there depends on
                // how the collection is supposed to be sorted and whether it's reversed.
                var sStartingScore = '';
                if (hOpts.sFirstID) {
                    if (hOpts.bReverse)
                        sStartingScore = ' AND '+hOpts.sOrderBy+' <= ';
                    else
                        sStartingScore = ' AND '+hOpts.sOrderBy+' >= ';

                    if (hOpts.sOrderBy == sKeyProperty)
                        sStartingScore += '\''+hOpts.sFirstID+'\'';
                    else
                        sStartingScore += '(SELECT '+hOpts.sOrderBy+' FROM '+sTbl+' WHERE '+sKeyProperty+'=\''+hOpts.sFirstID+'\')';
                }

                var sSelect = 'SELECT * FROM '+sTbl+sWhere;
                aStatements.push(sSelect + sStartingScore + sMin + sMax + sGroupBy + sOrderBy + sLimit);
                aValues = aValues.concat(aValues);

                Config.debug(aStatements,aValues);

                sStatement = aStatements.join(';');
                oClient.query(sStatement,aValues,function(err,res){
                    oSelf.release(oClient)
                    callback(err,res);
                });
            }
            ,function(aResults,callback) {
                if (aResults && aResults.length > 0) {
                    cColl.nTotal = aResults[0][0].nTotal;
                    if (cColl.nTotal) cColl.sSource = 'MySql';

                    // Keep track of missing items. If any are found, remove them and retry this call.
                    if (aResults[1] && aResults[1].length) {
                        if (hOpts.nSize && aResults[1][hOpts.nSize]) {
                            cColl.nNextID = aResults[1][hOpts.nSize][sKeyProperty];
                            aResults[1].splice(-1,1);
                        }
                        cColl.setData(aResults[1]);
                    }
                }
                callback();
            }
        ],function(err){
            if (err)
                oSelf._handleDbError(err,cColl,sDbAlias,fnCallback,'loadCollection',[hOpts,cColl,function(err){
                    oSelf.dispatchResult(err,cColl,fnCallback);
                }]);
             else
                oSelf.dispatchResult(null,cColl,fnCallback);
        });
};
/**
 * Saves an object to MySql.
 * @param hOpts
 * @param oObj
 * @param fnCallback
 */
p.saveObject = function(hOpts,oObj,fnCallback) {
    var oSelf = this;

    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';
    var sDbAlias = oObj.getSettings().sDbAlias;
    var bDone;

    if (oObj.getSettings().sSource == 'Redis') {
        fnCallback();
    } else
        oSelf.acquire(function(err,oClient){
            if (err) {
                oSelf.release(oClient);
                fnCallback(err,oObj);
            } else {
                var aStatements = [];
                var aValues = [];

                var aNames = [];
                var aQMarks = [];

                if (oObj.hDelta && !oObj.bNew && (!hOpts || !hOpts.bForce)) {

                    for (var sProp in oObj.hDelta) {
                        switch (oObj.getSettings().hProperties[sProp].sType) {
                            case 'Number':case 'Timestamp':case 'Float':case 'Decimal':
                            if (oObj.get(sProp) != undefined &&  (oObj.get(sProp).toString() == '' || oObj.get(sProp).toString() == 'NaN' || oObj.get(sProp).toString() == 'null' ||oObj.get(sProp).toString() == 'undefined')) {
                                aNames.push(sProp+'=NULL');
                            } else if (isNaN(oObj.get(sProp)) === false) {
                                aNames.push(sProp+'=?');
                                aValues.push(oObj.get(sProp));
                            }
                            break;
                            case 'Boolean':
                                aNames.push(sProp+'=?');
                                aValues.push(oObj.get(sProp));
                                break;
                            default:
                                if (oObj.get(sProp)) {
                                    aNames.push(sProp+'=?');
                                    aValues.push(oObj.get(sProp).toString());
                                } else {
                                    aNames.push(sProp+'=\'\'');
                                }
                                break;
                        }
                    }

                    if (aNames.length) {
                        aStatements.push('UPDATE '+sTable+' SET '+aNames.join(',')+' WHERE '+oObj.getSettings().sKeyProperty+' = ?');
                        aValues.push(oObj.getKey());
                    }

                } else {
                    oObj.getSettings().aProperties.forEach(function(sProp){
                        switch (oObj.getSettings().hProperties[sProp].sType) {
                            case 'Number':case 'Timestamp':case 'Float':case 'Decimal':
                            if (!oObj.get(sProp) && oObj.get(sProp) !== 0) {
                                // Skip it if the primary key value isn't set. It's an INSERT.
                                aNames.push(sProp.toString());
                                aQMarks.push('NULL');
                            } else if (isNaN(oObj.get(sProp))===false) {
                                aNames.push(sProp);
                                aValues.push(oObj.get(sProp));
                                aQMarks.push('?');
                            }
                            break;
                            case 'Boolean':
                                aNames.push(sProp);
                                aValues.push(oObj.get(sProp));
                                aQMarks.push('?');
                                break;
                            case 'String':
                                aNames.push(sProp);
                                if (oObj.get(sProp))
                                    aValues.push(oObj.get(sProp).toString());
                                else
                                    aValues.push('');
                                aQMarks.push('?');
                                break;
                            default:
                                throw new Error('Property is not defined: '+sProp+' on class '+oObj.sClass);
                                break;
                        }
                    });
                    if (!oObj.getKey())
                        aStatements.push('INSERT INTO '+sTable+' ('+aNames.join(',')+') VALUES ('+aQMarks.join(',')+')');
                    else
                        aStatements.push('REPLACE INTO '+sTable+' ('+aNames.join(',')+') VALUES ('+aQMarks.join(',')+')');
                }

                // Store cross-reference links for any secondary key lookups.
                if (oObj.getSettings().aSecondaryLookupKeys) {
                    for (var i = 0; i < oObj.getSettings().aSecondaryLookupKeys.length; i++) {
                        var sSecondaryKey = oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]);
                        if (sSecondaryKey) {
                            aStatements.push('INSERT INTO _CrossReferenceTbl (sID,RefID) VALUES (?,?) ON DUPLICATE KEY UPDATE RefID=?');
                            aValues.push(oObj.getClass()+':'+sSecondaryKey);
                            aValues.push(oObj.getKey().toString());
                            aValues.push(oObj.getKey().toString());
                        }
                    }
                }

                Config.silly(aStatements);
                Config.silly(aValues);

                oClient.query(aStatements.join(';')+';',aValues,function(err){
                    oSelf.release(oClient);
                    if (err)
                        oSelf._handleDbError(err,oObj,sDbAlias,fnCallback,'saveObject',[hOpts,oObj,function(err){
                            oSelf.dispatchResult(err,oObj,fnCallback);
                        }]);
                    else if (!bDone) {
                        bDone = true;
                        fnCallback(null, oObj);
                    }
                });
            }
        },sDbAlias);
};
/**
 * This method removes the item from MySql using its nID value. It also removes any secondary lookup
 * keys in the _CrossReferenceTbl.
 * @param oObj
 * @param fnCallback
 */
p.deleteObject = function(oObj,fnCallback){
    var oSelf = this;
    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';
    var sDbAlias = oObj.getSettings().sDbAlias;
    var bDone;

    oSelf.acquire(function(err,oClient){
        if (err) {
            oSelf.release(oClient);
            fnCallback(err);
        } else {
            var aStatements = [];
            var aValues = [];

            aStatements.push('DELETE FROM '+sTable+' WHERE '+oObj.getSettings().sKeyProperty+' = ?');
            aStatements.push('DELETE FROM _CrossReferenceTbl WHERE RefID=?');
            aValues.push(oObj.getKey());
            aValues.push(oObj.getKey());

            var aCrossRefQMarks = [];
            var aCrossRefValues = [];
            if (oObj.getSettings().aSecondaryLookupKeys) {
                for (var i = 0; i < oObj.getSettings().aSecondaryLookupKeys.length; i++) {
                    var sSecondaryKey = oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]);
                    if (sSecondaryKey) {
                        aCrossRefQMarks.push('?');
                        aValues.push(oObj.getClass()+':'+sSecondaryKey);
                    }
                }
            }

            var hExtras = oObj.getSettings().hExtras;
            for (var sProperty in hExtras) {
                if (hExtras[sProperty].sType == 'Object') {
                    aCrossRefQMarks.push('?');
                    aCrossRefValues.push(oObj.getRedisKey()+':'+sProperty);
                }            }
            if (aCrossRefQMarks.length > 0) {
                aStatements.push('DELETE FROM _CrossReferenceTbl WHERE sID IN ('+aCrossRefQMarks.join(',')+')');
                aValues = aValues.concat(aCrossRefValues);
            }

            Config.silly(aStatements);
            Config.silly(aValues);

            oClient.query(aStatements.join(';')+';',aValues,function(err){
                oSelf.release(oClient)
                if (err)
                    oSelf._handleDbError(err,oObj,sDbAlias,fnCallback,'saveObject',[oObj,function(err){
                        oSelf.dispatchResult(err,oObj,fnCallback);
                    }]);
                else if (!bDone){
                    bDone = true;
                    oSelf.dispatchResult(err,oObj,fnCallback);
                }
            });
        }
    },sDbAlias);

};
/**
 * Table validation and creation.
 * @param err
 * @param oObj
 * @param sDbAlias
 * @param fnCallback
 * @private
 */
p._handleDbError = function(err,oObj,sDbAlias,fnCallback,sFnRetry,aRetryArgs) {
    var oSelf = this;
    oObj.sErr = (err && err.code) ? err.code.toString() : (err) ? err.toString() : '';

    function handleResult(err,res){
        setImmediate(function(){
            if ((!oObj.nRetries || oObj.nRetries < 3) && sFnRetry) {
                oObj.nRetries = (oObj.nRetries) ? (oObj.nRetries+1) : 1;
                delete oObj.sErr;
                oSelf[sFnRetry].apply(oSelf,aRetryArgs);
            } else if (fnCallback)
                fnCallback(err,res);
        });
    }

    if (oObj.nRetries > 2)
        handleResult(err);
    else
        // Handle as many errors as we can.
        switch (oObj.sErr) {
            case 'ER_NO_SUCH_TABLE':
            case 'ER_PARSE_ERROR':
                setImmediate(function(){
                    oSelf.confirmTable(sDbAlias,oObj,handleResult);
                });
                break;
            case 'ER_BAD_FIELD_ERROR':
                setImmediate(function(){
                    oSelf._confirmColumns(sDbAlias,oObj,handleResult);
                });
                break;
            default:
                handleResult();
                break;
        }
};

p._checkTable = function(sDbAlias,sTable,fnCallback) {
    var oSelf = this;

    function handleResult(err,res) {
        fnCallback(err,(res && res.length > 0));
    }

    oSelf.acquire(function(err,oClient){
        if (err) {
            oSelf.release(oClient);
            fnCallback(err);
        } else
            oClient.query('SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = \''+this.hOpts[oClient.sDbAlias].sSchema+'\' AND TABLE_NAME = \''+sTable+'\';',function(err,aResults){
                oSelf.release(oClient)
                if (err)
                    oSelf._handleDbError(err,oObj,sDbAlias,handleResult,'_checkTable',[sDbAlias,sTable,handleResult]);
                else
                    handleResult(err,aResults);
            });
    },sDbAlias);

};
/**
 * This method confirms the existence of the table needed to store the passed-in
 * object's data. It creates the table if not found.
 * @param oClient
 * @param oObj
 * @param fnCallback
 */
p.confirmTable = function(sDbAlias,oObj,fnCallback) {
    var oSelf = this;
    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';
    var sSchema = (oSelf.hOpts[sDbAlias]) ? '`'+oSelf.hOpts[sDbAlias].sSchema+'`.' : '';

    async.waterfall([
        function(callback) {
            oSelf._checkTable(sDbAlias,'_CrossReferenceTbl',function(err,bExists){
                if (!err && !bExists) {

                    oSelf.acquire(function(err,oClient){
                        if (err) {
                            oSelf.release(oClient);
                            callback(err);
                        } else
                            oClient.query('CREATE TABLE IF NOT EXISTS '+sSchema+'`_CrossReferenceTbl` (`sID` CHAR(140) NOT NULL, RefID CHAR(100),PRIMARY KEY (`sID`))',function(err){
                                oSelf.release(oClient)
                                if (!err || err.code.toString() == 'ER_TABLE_EXISTS_ERROR')
                                    callback(err,true);
                                else
                                    callback(err);
                            });
                    },sDbAlias);

                } else
                    callback(err,true);
            });
        },
        function(bExists,callback){
            var sKey = [];
            if (oObj.getSettings().sKeyProperty) {
                if (oObj.getSettings().hProperties[oObj.getSettings().sKeyProperty].sType == 'String') {
                    var nLength = oObj.getSettings().hProperties[oObj.getSettings().sKeyProperty].nLength||64;
                    sKey = '`'+oObj.getSettings().sKeyProperty+'` CHAR('+nLength+') NOT NULL, PRIMARY KEY (`'+oObj.getSettings().sKeyProperty+'`)';
                } else
                    sKey = '`'+oObj.getSettings().sKeyProperty+'` BIGINT NOT NULL, PRIMARY KEY (`'+oObj.getSettings().sKeyProperty+'`)';


                oSelf.acquire(function(err,oClient){
                    if (err) {
                        oSelf.release(oClient);
                        callback(err);
                    } else
                        oClient.query('CREATE TABLE  IF NOT EXISTS '+sSchema+'`'+sTable+'` ('+sKey+')',function(err){
                            oSelf.release(oClient)
                            if (!err || err.code.toString() == 'ER_TABLE_EXISTS_ERROR')
                                callback(null,true);
                            else
                                callback(err);
                        });
                },sDbAlias);

            } else
                callback();
        }
    ],fnCallback);
};
/**
 * This method is used to confirm and/or create columns within a table.
 * @param oClient
 * @param oObj
 * @param fnCallback
 */
p._confirmColumns = function(sDbAlias,oObj,fnCallback){
    var oSelf = this;
    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';

    var confirmColumn = function(sColumn,ind,cb) {
        var sType;
        switch (oObj.getSettings().hProperties[sColumn].sType) {
            case 'String':
                sType = 'TEXT NULL';
                if (oObj.getSettings().hProperties[sColumn].sMySqlType) {
                    sType = oObj.getSettings().hProperties[sColumn].sMySqlType;
                    if (oObj.getSettings().hProperties[sColumn].bIndex)
                        sType += '; ALTER TABLE `'+oSelf.hOpts[oClient.sDbAlias].sSchema+'`.`'+sTable+'` ADD INDEX `'+sTable+'_'+sColumn+'` (`'+sColumn+'` ASC)';
                }
                break;
            case 'Number':case 'Timestamp':
                sType = 'BIGINT NULL';
                break;
            case 'Float':
                sType = 'FLOAT';
                break;
            case 'Decimal':
                sType = 'DECIMAL('+oObj.getSettings().hProperties[sColumn].nMax+','+oObj.getSettings().hProperties[sColumn].nScale+')';
                break;
            case 'Boolean':
                sType = 'TINYINT DEFAULT 0';
                break;
        }
        Config.silly('ALTER TABLE `'+oSelf.hOpts[sDbAlias].sSchema+'`.`'+sTable+'` ADD COLUMN `'+sColumn+'` '+sType+';');

        oSelf.acquire(function(err,oClient){
            if (err) {
                oSelf.release(oClient);
                cb(err);
            } else
                oClient.query('ALTER TABLE `'+oSelf.hOpts[sDbAlias].sSchema+'`.`'+sTable+'` ADD COLUMN `'+sColumn+'` '+sType+';',function(err){
                    oSelf.release(oClient)
                    if (!err || err.code.toString() == 'ER_DUP_FIELDNAME')
                        cb();
                    else
                        cb(err);
                });
        },sDbAlias)

    };

    var oBase = Base.lookup({sClass:oObj.sClass});

    if (oBase.getSettings() && oBase.getSettings().aProperties && oBase.getSettings().aProperties.length) {
        // All tables include nCreated,nUpdated and nID;
        async.each(oBase.getSettings().aProperties,confirmColumn,function(err){
            setImmediate(function(){fnCallback(err)});
        });
    } else
        fnCallback('Do not know how to confirmColumns for '+oObj.sClass);

};
/**
 * Utility method for directly executing sql.
 * @param sQuery
 * @param aValues
 * @param fnCallback
 * @param sDbAlias
 */
p.execute = function(sQuery,aValues,fnCallback,sDbAlias) {
    var oSelf = this;
    sDbAlias = (sDbAlias) ? sDbAlias : 'default';

    oSelf.acquire(function(err, oClient) {
        if (err) {
            oSelf.release(oClient);
            fnCallback(err);
        } else {
            Config.silly(sQuery);
            Config.silly(aValues);

            function handleResult(err,res) {
                if (fnCallback) {
                    if (err)
                        fnCallback({err:err,sQuery:sQuery,aValues:aValues});
                    else
                        fnCallback(err,res);
                }
            }

            oClient.query(sQuery, aValues, function(err,res) {
                oSelf.release(oClient)
                if (err) {
                    console.log(err);
                    oSelf._handleDbError(err,{},sDbAlias,handleResult,'execute',[sQuery,aValues,handleResult,sDbAlias]);
                } else
                    handleResult(err,res);
            });
        }
    },sDbAlias);
};


module.exports = new MySql();