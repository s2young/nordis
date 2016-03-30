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
p.acquire = function(fnCallback,sDbAlias,sTrace) {
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
            if (oClient) oClient.release();
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
 * @param bEnd
 */
p.release = function(oClient) {
    if (oClient && oClient.release) oClient.release();
};
/**
 * All callbacks pass through here to make sure we release our connection properly.
 * @param err
 * @param oObj
 * @param fnCallback
 * @param oClient
 */
p.dispatchResult = function(err,oObj,fnCallback,oClient) {
    if (err) Config.error(err);
    if (oClient && oClient.release)  oClient.release();
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
    var oClient;

    async.series([
        // If the settings call for skipping MySql, or if the object is already loaded, we'll just call back.
        // Otherwise, we check for a db connection and create one if needed.
        function(callback){
            if (bSkip)
                callback();
            else
                oSelf.acquire(function(err,oResult){
                    oClient = oResult;
                    callback(err);
                },sDbAlias);
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

                    async.parallel([
                        function(cb) {
                            if (hQuery.aValues && hQuery.aValues.length > 0)
                                oClient.query(hQuery.aStatements.join(';'),hQuery.aValues,cb);
                            else
                                oClient.query(hQuery.aStatements.join(';')+';',null,cb);
                        }
                    ],function(err,aResults){
                        if (err) {

                            delete oObj.sSource;
                            oSelf._handleDbError(err,oObj,oClient,callback,'loadObject',[hOpts,oObj,callback]);

                        } else if (aResults && aResults[0] && aResults[0][0] && aResults[0][0][0]) {
                            oObj.hData = aResults[0][0][0];
                            oObj.sSource = 'MySql';
                            callback(err,oObj);
                        } else {
                            // If we used a secondary lookup field, then let's just try looking in that field directly.
                            // This is less performant, especially if the column isn't properly indexed. But we shouldn't
                            // fail just because the _CrossRef table is messed up. Fix that too, if we find something.
                            if (hQuery.sLookupField) {
                                oSelf.loadObjectBySecondary(hQuery,oObj,oClient,callback);
                            } else
                                callback(err,oObj);
                        }
                    });
                }
            } else
                callback();
        }
    ],function(err){
        oSelf.dispatchResult(err,oObj,fnCallback,oClient);
    });
};
/**
 * If a secondary key lookup fails, we look directly into the object table for the secondary field.  This also
 * updates the _CrossReferenceTbl so the failure doesn't happen again.
 * @param hQuery
 * @param oObj
 * @param oClient
 * @param fnCallback
 */
p.loadObjectBySecondary = function(hQuery,oObj,oClient,fnCallback){
    var oSelf = this;
    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';
    var sSql = 'SELECT * FROM '+sTable+' WHERE '+hQuery.sLookupField+'=?;';

    Config.silly(sSql);
    Config.silly(hQuery.aLookupValue);

    oClient.query(sSql,hQuery.aLookupValue,function(err,aRes){
        if (err)
            oSelf._handleDbError(err,oObj,oClient,fnCallback,'loadObjectBySecondary',[hQuery,oObj,oClient,fnCallback]);
        else if (aRes && aRes[0]) {
            oObj.hData = aRes[0];
            oObj.sSource = 'MySql';
            oSelf._updateCrossRef(oObj,fnCallback);
        } else
            fnCallback(null,oObj);
    });
};

p._updateCrossRef = function(oObj,fnCallback) {
    var oSelf = this;
    // Update the cross-ref table so this doesn't happen again.
    oClient.query('INSERT INTO _CrossReferenceTbl (sID,RefID) VALUES (?,?) ON DUPLICATE KEY UPDATE RefID=?',[oObj.getRedisKey(oObj.get(hQuery.sLookupField)),oObj.getKey().toString(),oObj.getKey().toString()],function(err){
        if (err)
            oSelf._handleDbError(err,oObj,oClient,fnCallback,'_updateCrossRef',[oObj,fnCallback]);
        else
            fnCallback(null,oObj);
    });
};

p._updateSortedSet = function(Key,Score,oObj,oClient,fnCallback) {
    var oSelf = this;
    oClient.query('INSERT INTO _SortedSetTbl (sID,nScore,RefID) VALUES (?,?,?) ON DUPLICATE KEY UPDATE nScore=?;',[Key,Score,oObj.getKey().toString(),Score],function(err){
        if (err)
            oSelf._handleDbError(err,oObj,oClient,fnCallback,'_updateSortedSet',[Key,Score,oObj.getKey(),oClient,fnCallback]);
        else
            fnCallback();
    });
};

p._removeFromSortedSet = function(sKey,oObj,oClient,fnCallback){
    var oSelf = this;
    oClient.query('DELETE FROM _SortedSetTbl WHERE sID=?;',[sKey],function(err){
        if (err)
            oSelf._handleDbError(err,oObj,oClient,fnCallback,'_removeFromSortedSet',[sKey,oObj,oClient,fnCallback]);
        else
            fnCallback();
    });
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
 * @param oClient
 */
p.loadCollection = function(hOpts,cColl,fnCallback) {
    var oSelf = this;

    if (!Config) {
        Base = require('./../../Base');
        Config = require('./../../AppConfig');
    }

    var sKeyProperty = Config.getClasses(cColl.sClass).sKeyProperty;
    var sDbAlias = (oSelf.hOpts[Config.getClasses(cColl.sClass).sDbAlias]) ? Config.hClasses[cColl.sClass].sDbAlias : 'default';
    var oClient;

    if (!hOpts.hQuery) {
        oSelf.dispatchResult(null,cColl,fnCallback);
    } else
        async.waterfall([
            function(callback){
                oSelf.acquire(callback, sDbAlias, 'loadCollection' + cColl.sClass);
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

                oClient.query(aStatements.join(';'),aValues,function(err,res){
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
                oSelf._handleDbError(err,oObj,oClient,fnCallback,'loadCollection',[hOpts,cColl,function(err){
                    oSelf.dispatchResult(err,cColl,fnCallback,oClient);
                }]);
             else
                oSelf.dispatchResult(null,cColl,fnCallback,oClient);
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

    if (oObj.getSettings().sSource == 'Redis') {
        fnCallback();
    } else
        oSelf.acquire(function(err,oClient){
            if (err)
                oSelf.dispatchResult(err,oObj,fnCallback,oClient);
            else {
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
                    if (err)
                        oSelf._handleDbError(err,oObj,oClient,fnCallback,'saveObject',[hOpts,oObj,function(err){
                            oSelf.dispatchResult(err,oObj,fnCallback,oClient);
                        }]);
                    else
                        oSelf.dispatchResult(null, oObj, fnCallback, oClient);
                });
            }
        },oObj.getSettings().sDbAlias);
};
/**
 * This method removes the item from MySql using its nID value. It also removes any secondary lookup
 * keys in the _CrossReferenceTbl.
 * @param oObj
 * @param fnCallback
 * @param oClient - (optional) existing db connection.
 */
p.deleteObject = function(oObj,fnCallback,oClient){
    var oSelf = this;
    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';

    async.waterfall([
        function(callback){
            if (oClient)
                callback(null,oClient);
            else
                oSelf.acquire(callback,oObj.getSettings().sDbAlias,'deleteObject'+oObj.sClass);
        }
    ],function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oObj,fnCallback,oClient);
        else {
            var aStatements = [];
            var aValues = [];

            aStatements.push('DELETE FROM '+sTable+' WHERE '+oObj.getSettings().sKeyProperty+' = ?');
            aStatements.push('DELETE FROM _CrossReferenceTbl WHERE RefID=?');
            aStatements.push('DELETE FROM _SortedSetTbl WHERE RefID=?');
            aValues.push(oObj.getKey());
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

            var aSortedSetQMarks = [];
            var aSortedSetValues = [];

            var hExtras = oObj.getSettings().hExtras;
            for (var sProperty in hExtras) {
                if (hExtras[sProperty].sType == 'Object') {
                    aCrossRefQMarks.push('?');
                    aCrossRefValues.push(oObj.getRedisKey()+':'+sProperty);
                } else if (hExtras[sProperty].sType == 'Collection') {
                    aSortedSetQMarks.push('?');
                    aSortedSetValues.push(oObj.getRedisKey()+':'+sProperty);
                }
            }
            if (aCrossRefQMarks.length > 0) {
                aStatements.push('DELETE FROM _CrossReferenceTbl WHERE sID IN ('+aCrossRefQMarks.join(',')+')');
                aValues = aValues.concat(aCrossRefValues);
            }
            if (aSortedSetQMarks.length > 0) {
                aStatements.push('DELETE FROM _SortedSetTbl WHERE sID IN ('+aSortedSetQMarks.join(',')+')');
                aValues = aValues.concat(aSortedSetValues);
            }

            Config.silly(aStatements);
            Config.silly(aValues);

            oClient.query(aStatements.join(';')+';',aValues,function(err){
                if (err)
                    oSelf._handleDbError(err,oObj,oClient,fnCallback,'saveObject',[oObj,function(err){
                        oSelf.dispatchResult(err,oObj,fnCallback,oClient);
                    },oClient]);
                else
                    try {
                        oSelf.dispatchResult(err,oObj,fnCallback,oClient);
                    } catch (err2) {
                        // MySql calls back for each statement, so we only want to callback once.
                    }

            });
        }
    });
};
/**
 * This method is used to add or replace items in a MySql Set, which is an unordered list of objects.
 * In our framework, we always only store primary key ids in these lists and these ids simply point to
 * full objects stored in MySql by those keys.
 *
 * @param hOpts - Hash expecting sKey, sValue.
 * @param oObj
 * @param fnCallback
 */
p.addToSet = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oObj,fnCallback,oClient);
        else {
            if (hOpts && hOpts.sKey) {
                var sOrderBy = (hOpts.sOrderBy) ? hOpts.sOrderBy : 'nCreated';
                var nScore = (oObj.nScore) ? oObj.nScore : Number(oObj.get(sOrderBy));
                // If the sorting value is a string, convert it to a number.
                if (nScore.toString()=='NaN') {
                    nScore = 0;
                    var n = 3;
                    var letters = oObj.get(sOrderBy).toLowerCase().split('');
                    for (var i = 0; i < 4; i++) {
                        if (letters[i]) {
                            var byte = letters[i].charCodeAt(0);
                            nScore += byte * Math.pow(256,n);
                            n--;
                        }
                    }
                    oObj.nScore = nScore;
                }
   
                if (!nScore && (oObj.get(sOrderBy)==null || oObj.get(sOrderBy)==undefined))
                    oSelf.dispatchResult('Score missing for '+oObj.sClass+'. Looking for \''+sOrderBy+'\' on key '+hOpts.sKey+' and found '+oObj.get(sOrderBy),oObj,fnCallback,oClient);
                else
                    oSelf._updateSortedSet(hOpts.sKey,nScore,oObj,oClient,function(err){
                        oSelf.dispatchResult(err,oObj,fnCallback,oClient);
                    });

            } else
                oSelf.dispatchResult('sKey missing.',oObj,fnCallback,oClient);
        }
    },oObj.getSettings().sDbAlias,'addToSet'+oObj.sClass);
};
/**
 * Remove from _SortedSetTbl
 * @param hOpts
 * @param oObj
 * @param fnCallback
 */
p.removeFromSet = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oObj,fnCallback,oClient);
        else {
            if (hOpts && hOpts.sKey)

                oSelf._removeFromSortedSet(hOpts.sKey,oObj,oClient,function(err){
                    oSelf.dispatchResult(err,oObj,fnCallback,oClient);
                });

            else
                oSelf.dispatchResult('sKey missing.',oObj,fnCallback,oClient);
        }
    },oObj.getSettings().sDbAlias,'addToSet'+oObj.sClass);
};
/**
 * Table validation and creation.
 * @param err
 * @param oObj
 * @param oClient
 * @param fnCallback
 * @private
 */
p._handleDbError = function(err,oObj,oClient,fnCallback,sFnRetry,aRetryArgs) {
    var oSelf = this;
    oObj.sErr = (err && err.code) ? err.code.toString() : (err) ? err.toString() : '';

    function handleResult(err,res){
        setImmediate(function(){
            console.log(oObj.sErr,oObj.nRetries);
            if ((!oObj.nRetries || oObj.nRetries < 3) && sFnRetry) {
                oObj.nRetries = (oObj.nRetries) ? (oObj.nRetries+1) : 1;
                delete oObj.sErr;
                console.log(sFnRetry.toString());
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
                    oSelf.confirmTable(oClient,oObj,handleResult);
                });
                break;
            case 'ER_BAD_FIELD_ERROR':
                setImmediate(function(){
                    oSelf._confirmColumns(oClient,oObj,handleResult);
                });
                break;
            default:
                handleResult();
                break;
        }
};

p._checkTable = function(oClient,sTable,fnCallback) {

    function handleResult(err,res) {
        fnCallback(err,(res && res.length > 0));
    }

    oClient.query('SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = \''+this.hOpts[oClient.sDbAlias].sSchema+'\' AND TABLE_NAME = \''+sTable+'\';',function(err,aResults){
        if (err)
            oSelf._handleDbError(err,oObj,oClient,handleResult,'_checkTable',[oClient,sTable,handleResult]);
        else
            handleResult(err,aResults);
    });
};
/**
 * This method confirms the existence of the table needed to store the passed-in
 * object's data. It creates the table if not found.
 * @param oClient
 * @param oObj
 * @param fnCallback
 */
p.confirmTable = function(oClient,oObj,fnCallback) {
    var oSelf = this;
    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';
    var sSchema = (oClient.sDbAlias && oSelf.hOpts[oClient.sDbAlias]) ? '`'+oSelf.hOpts[oClient.sDbAlias].sSchema+'`.' : '';

    async.waterfall([
        function(callback) {
            oSelf._checkTable(oClient,'_CrossReferenceTbl',function(err,bExists){
                if (!err && !bExists) {
                    oClient.query('CREATE TABLE IF NOT EXISTS '+sSchema+'`_CrossReferenceTbl` (`sID` CHAR(140) NOT NULL, RefID CHAR(100),PRIMARY KEY (`sID`))',function(err){
                        if (!err || err.code.toString() == 'ER_TABLE_EXISTS_ERROR')
                            callback(err,true);
                        else
                            callback(err);
                    });
                } else
                    callback(err,true);
            });
        },
        function(bExists,callback) {
            oSelf._checkTable(oClient,'_SortedSetTbl',function(err,bExists){

                if (!err && !bExists) {
                    oClient.query('CREATE TABLE IF NOT EXISTS '+sSchema+'`_SortedSetTbl` (`sID` CHAR(40) NOT NULL, nScore BIGINT NULL, RefID CHAR(100) NULL);ALTER TABLE `_SortedSetTbl` ADD INDEX `_SortedSetTbl_sID` (`sID` ASC);ALTER TABLE `_SortedSetTbl` ADD INDEX `_SortedSetTbl_nScore` (`nScore` ASC);ALTER TABLE `_SortedSetTbl` ADD UNIQUE INDEX `_SortedSetTbl_sID_RefID` (`sID` ASC, `RefID` ASC);',function(err){
                        if (!err || err.code.toString() == 'ER_TABLE_EXISTS_ERROR' || err.code.toString() == 'ER_DUP_KEYNAME')
                            callback(err,true);
                        else
                            callback(err);
                    });
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


                oClient.query('CREATE TABLE  IF NOT EXISTS '+sSchema+'`'+sTable+'` ('+sKey+')',function(err){
                    if (!err || err.code.toString() == 'ER_TABLE_EXISTS_ERROR')
                        callback(null,true);
                    else
                        callback(err);
                });
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
p._confirmColumns = function(oClient,oObj,fnCallback){
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
        Config.silly('ALTER TABLE `'+oSelf.hOpts[oClient.sDbAlias].sSchema+'`.`'+sTable+'` ADD COLUMN `'+sColumn+'` '+sType+';');
        oClient.query('ALTER TABLE `'+oSelf.hOpts[oClient.sDbAlias].sSchema+'`.`'+sTable+'` ADD COLUMN `'+sColumn+'` '+sType+';',function(err){
            if (!err || err.code.toString() == 'ER_DUP_FIELDNAME')
                cb();
            else
                cb(err);
        });
    };

    var oBase = Base.lookup({sClass:oObj.sClass});

    if (oBase.getSettings() && oBase.getSettings().aProperties && oBase.getSettings().aProperties.length) {
        // All tables include nCreated,nUpdated and nID;
        async.forEachOfLimit(oBase.getSettings().aProperties,1,confirmColumn,function(err){
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
        Config.silly(sQuery);
        Config.silly(aValues);

        function handleResult(err,res) {
            if (oClient && oClient.release) oClient.release();
            if (fnCallback) {
                if (err)
                    fnCallback({err:err,sQuery:sQuery,aValues:aValues});
                else
                    fnCallback(err,res);
            }
        }

        oClient.query(sQuery, aValues, function(err,res) {
            if (err)
                oSelf._handleDbError(err,{},oClient,handleResult,'execute',[sQuery,aValues,handleResult,sDbAlias]);
            else
                handleResult(err,res);
        });
    },sDbAlias,'execute');
};


module.exports = new MySql();