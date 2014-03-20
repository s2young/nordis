var mysql       = require('mysql'),
    async       = require('async'),
    Str         = require('./../String'),
    poolModule  = require('generic-pool');

var AppConfig;
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
    var oSelf = this;

    // Create a 'default' db alias if none is provided in config.
    if (hOpts.sSchema)
        hOpts = {default:hOpts};

    oSelf.hOpts = hOpts;
    oSelf.dbPool = {};
};

var createPool = function(hOpts,sDbAlias) {
    if (!AppConfig) AppConfig = require('./../../AppConfig');
    return poolModule.Pool({
        name     : 'mysql',
        create   : function(callback) {
            var c = mysql.createConnection({
                host:hOpts.sHost,
                debug:false,
                user:hOpts.sUser,
                password:hOpts.sPass,
                database:hOpts.sSchema,
                charset:'utf8',
                multipleStatements:true
            });
            c.sDbAlias = sDbAlias;

            if (AppConfig.bTraceMode)
                c.sID = sDbAlias+'-'+Str.getSID(8);

            callback(null, c);
        },
        destroy  : function(client) {
            client.end(function(err){
                if (err)
                    AppConfig.error(err);
            })
        },
        max: hOpts.nMaxConnections,
        idleTimeoutMillis: hOpts.nTimeoutMilliseconds,
        log:hOpts.bDebugMode
    });
};
/**
 * Connection pool acquisition.
 * @param fnCallback
 */
p.acquire = function(fnCallback,sDbAlias) {
    var sDbAlias = (this.hOpts[sDbAlias]) ? sDbAlias : 'default';
    if (!this.dbPool[sDbAlias])
        this.dbPool[sDbAlias] = createPool(this.hOpts[sDbAlias],sDbAlias);
    this.dbPool[sDbAlias].acquire(fnCallback);
};
/**
 * Common release method just for consistency with acquire. Also helpful with debugging.
 * @param oClient
 */
p.release = function(oClient) {
    var sDbAlias = (oClient.sDbAlias) ? oClient.sDbAlias : 'default';
    this.dbPool[sDbAlias].release(oClient);
};
/**
 * All callbacks pass through here to make sure we release our connection properly.
 * @param err
 * @param oClient
 * @param fnCallback
 * @param oResult
 */
p.dispatchResult = function(err,oClient,fnCallback,oResult) {
    var oSelf = this;
    if (err) AppConfig.error(err);
    if (oClient) {
        if (oResult) AppConfig.trace(oResult.sID,{MySql:{sID:oClient.sID,bReleased:true}});
        oSelf.release(oClient);
    }
    if (oResult) delete oResult.sID;
    if (fnCallback) fnCallback(err,oResult);
};
/**
 * This method loads an object using the passed-in hQuery, which must be a single name-value
 * pair using either the primary key or a valid secondary lookup field.
 * @param hOpts
 * @param oObj
 * @param fnCallback
 * @param oClient - existing db connection (optional)
 */
p.loadObject = function(hOpts,oObj,fnCallback,oClient) {
    var oSelf = this;
    var sDbAlias = (oSelf.hOpts[oObj.getSettings().sDbAlias]) ? oObj.getSettings().sDbAlias : 'default';
    var bSkip = (oSelf.hOpts[sDbAlias].bSkip||oObj.getKey());

    var oClient = oClient;
    async.waterfall([
        // If the settings call for skipping MySql, or if the object is already loaded, we'll just call back.
        // Otherwise, we check for a db connection and create one if needed.
        function(callback){
            if (bSkip)
                callback(null,null);
            else if (oClient)
                callback(null,oClient);
            else
                oSelf.acquire(callback,sDbAlias);
        }
        // Do the lookup if needed.
        ,function(oResult,callback) {
            oClient = oResult;
            if (oClient  && !bSkip) {
                // First get the object itself.
                var hQuery = oSelf.generateQuery(hOpts.hQuery,oObj);
                if (!hQuery || !hQuery.aStatements.length)
                    callback();
                else {
                    AppConfig.silly(hQuery.aStatements);
                    AppConfig.silly(hQuery.aValues);
                    AppConfig.trace(oObj.id,{MySql:{db:oClient.id}});

                    async.parallel([
                        function(cb) {
                            if (hQuery.aValues && hQuery.aValues.length > 0)
                                oClient.query(hQuery.aStatements.join(';'),hQuery.aValues,cb);
                            else
                                oClient.query(hQuery.aStatements.join(';')+';',null,cb);
                        }
                    ],function(err,aResults){
                        if (err) {
                            AppConfig.trace(oObj.sID,{err:err});
                            delete oObj.sSource;
                            oSelf._handleDbError(err,oObj,oClient,function(err){
                                if (err)
                                    callback(err,oObj);
                                else {
                                    delete oObj.sErr;
                                    oSelf.loadObject(hOpts,oObj,callback,oClient);
                                }
                            });
                        } else if (aResults && aResults[0] && aResults[0][0] && aResults[0][0][0]) {
                            AppConfig.trace(oObj.sID,{sSource:'MySql'});
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
                callback(null,oObj);
        }
    ],function(err,oObj){
        oSelf.dispatchResult(err,oClient,fnCallback,oObj);
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

    AppConfig.silly(sSql);
    AppConfig.silly(hQuery.aLookupValue);

    oClient.query(sSql,hQuery.aLookupValue,function(err,aRes){
        if (err) {
            AppConfig.trace(oObj.sID,{loadObjectBySecondary:{aStatements:sSql,aValues:hQuery.aLookupValue,err:err}});
            oSelf._handleDbError(err,oObj,oClient,function(err){
                if (err)
                    fnCallback(err,oObj);
                else {
                    delete oObj.sErr;
                    oSelf.loadObjectBySecondary(hQuery,oObj,oClient,fnCallback);
                }
            });
        } else if (aRes && aRes[0]) {
            oObj.hData = aRes[0];
            oObj.sSource = 'MySql';
            AppConfig.trace(oObj.sID,{loadObjectBySecondary:{aStatements:sSql,aValues:hQuery.aLookupValue,sSource:'MySql'}});
            // Update the cross-ref table so this doesn't happen again.
            oClient.query('INSERT INTO _CrossReferenceTbl (sID,RefID) VALUES (?,?) ON DUPLICATE KEY UPDATE RefID=?',[oObj.getClass()+':'+oObj.get(hQuery.sLookupField),oObj.getKey(),oObj.getKey()],function(err){
                fnCallback(err,oObj);
            });
        } else {
            AppConfig.trace(oObj.sID,{loadObjectBySecondary:{aStatements:sSql,aValues:hQuery.aLookupValue}});
            fnCallback(null,oObj);
        }
    });
};
/**
 * This method generates a parameterized query for the passed-in object and query.
 * @param hQuery
 * @param oObj
 * @param sProperty
 * @returns {{aStatements: Array, aValues: Array}}
 */
p.generateQuery = function(hQuery,oObj) {
    if (!hQuery) {
        return;
    } else {
        var hResult = {aStatements:[],aValues:[]};
        var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';
        if (hQuery.sWhere) {
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

                    if (sLookup != oObj.getSettings().sKeyProperty && (oObj.getSettings().hProperties[sLookup].bUnique||oObj.getSettings().hProperties[sLookup].bPrimary)) {
                        aCrossRefVals.push(oObj.getClass()+':'+hQuery[sLookup]);
                        if (aCrossRefVals.length == 1) {
                            hResult.sLookupField = sLookup;
                            hResult.aLookupValue = [hQuery[sLookup]];
                        }
                    }
                } else
                    AppConfig.warn('Attempting to lookup using a property ('+sLookup+') that does not exist on this class ('+oObj.sClass+')');
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

        if (AppConfig.bTraceMode) {
            if (!oObj.sID) oObj.sID = oObj.sClass+'-'+Str.getSID(5);
            AppConfig.trace(oObj.sID,{aStatements:hResult.aStatements,aValues:hResult.aValues});
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
p.loadCollection = function(hOpts,cColl,fnCallback,oClient) {
    var oSelf = this;
    if (!AppConfig) AppConfig = require('./../../AppConfig');

    var sKeyProperty = AppConfig.hClasses[cColl.sClass].sKeyProperty;
    var sDbAlias = (oSelf.hOpts[AppConfig.hClasses[cColl.sClass].sDbAlias]) ? AppConfig.hClasses[cColl.sClass].sDbAlias : 'default';

    if (!hOpts.hQuery)
        oSelf.dispatchResult(null,oClient,fnCallback,cColl);
    else
        async.waterfall([
            function(callback){
                if (oClient && oClient.sDbAlias == sDbAlias)
                    callback(null,oClient);
                else
                    oSelf.acquire(callback,sDbAlias);
            }
        ],function(err,oClient){
            // Pass down all the configuration options required to construct the collection appropriately.
            hOpts.nSize = hOpts.nSize || 0;
            hOpts.nFirstID = hOpts.nFirstID || null;
            hOpts.sOrderBy = hOpts.sOrderBy||sKeyProperty;
            hOpts.sGroupBy = hOpts.sGroupBy || null;
            hOpts.bReverse = hOpts.bReverse || false;
            hOpts.nMin = hOpts.nMin || null;
            hOpts.nMax = hOpts.nMax || null;

            var aStatements = [];
            var aValues = [];

            var sWhere;
            if (hOpts.hQuery && hOpts.hQuery.sWhere)
                sWhere = hOpts.hQuery.sWhere;
            else if (hOpts.hQuery) {
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
                sWhere = aParms.join(' AND ');
            }

            var sLimit = (hOpts.nSize && isNaN(hOpts.nSize)===false) ? ' LIMIT 0, ' + (Number(hOpts.nSize)+1) : '';
            var sOrderBy = (hOpts.sOrderBy) ? (hOpts.bReverse) ? ' ORDER BY '+hOpts.sOrderBy+' DESC' : ' ORDER BY '+hOpts.sOrderBy+' ASC': '';
            var sGroupBy = (hOpts.sGroupBy) ? ' GROUP BY '+hOpts.sGroupBy : '';
            var sMin = (hOpts.nMin && isNaN(hOpts.nMin)===false) ? (hOpts.bReverse) ? ' AND '+hOpts.sOrderBy+' <= '+hOpts.nMin : ' AND '+hOpts.sOrderBy+' >= '+hOpts.nMin : '';
            var sMax = (hOpts.nMax && isNaN(hOpts.nMax)===false) ? (hOpts.bReverse) ? ' AND '+hOpts.sOrderBy+' >= '+hOpts.nMax : ' AND '+hOpts.sOrderBy+' <= '+hOpts.nMax : '';

            // If you have a custom view or table name you can pass it in here:
            var sTbl = AppConfig.hClasses[cColl.sClass].sTable||cColl.sClass+'Tbl';

            if (sGroupBy)
                aStatements.push('SELECT COUNT(*) AS nTotal FROM (SELECT * FROM '+sTbl+' WHERE '+sWhere+sMin+sMax+sGroupBy+') sub');
            else
                aStatements.push('SELECT COUNT(*) AS nTotal FROM '+sTbl+' WHERE '+sWhere+sMin+sMax);

            // If nFirstID is passed in, it means that we should start there. The direction we go from there depends on
            // how the collection is supposed to be sorted and whether it's reversed.
            var sStartingScore = '';
            if (hOpts.nFirstID && isNaN(hOpts.nFirstID)===false) {
                if (hOpts.bReverse)
                    sStartingScore = ' AND '+hOpts.sOrderBy+' <= ';
                else
                    sStartingScore = ' AND '+hOpts.sOrderBy+' >= ';

                if (hOpts.sOrderBy == sKeyProperty)
                    sStartingScore += hOpts.nFirstID;
                else
                    sStartingScore += '(SELECT '+hOpts.sOrderBy+' FROM '+sTbl+' WHERE '+sKeyProperty+'='+hOpts.nFirstID+')';
            }

            var sSelect = 'SELECT * FROM '+sTbl+' WHERE '+sWhere;
            aStatements.push(sSelect + sStartingScore + sMin + sMax + sGroupBy + sOrderBy + sLimit);
            aValues = aValues.concat(aValues);

            AppConfig.silly(aStatements);
            AppConfig.silly(aValues);

            oClient.query(aStatements.join(';'),aValues,function(err,aResults){
                if (!err) {
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
                    oSelf.dispatchResult(null,oClient,fnCallback,cColl);
                } else
                    oSelf._handleDbError(err,cColl,oClient,function(err){
                        if (err)
                            oSelf.dispatchResult(err,oClient,fnCallback,cColl);
                        else {
                            delete cColl.sErr;
                            oSelf.loadCollection(hOpts,cColl,fnCallback,oClient);
                        }
                    });
            });
        });
};
/**
 * Saves an object to MySql.
 * @param hOpts
 * @param oObj
 * @param fnCallback
 * @param oClient
 */
p.saveObject = function(hOpts,oObj,fnCallback,oClient) {
    var oSelf = this;
    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';

    async.waterfall([
        function(callback){
            if (!oClient)
                oSelf.acquire(callback,oObj.getSettings().sDbAlias);
            else
                callback(null,oClient);
        }
    ],function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            var aStatements = [];
            var aValues = [];

            var aNames = [];
            var aQMarks = [];

            if (!oObj.bNew && oObj.hDelta) {
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
                                aNames.push(sProp);
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
                    if (oObj.get(oObj.getSettings().aSecondaryLookupKeys[i])) {
                        aStatements.push('INSERT INTO _CrossReferenceTbl (sID,RefID) VALUES (?,?) ON DUPLICATE KEY UPDATE RefID=?');
                        aValues.push(oObj.getClass()+':'+oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]));
                        aValues.push(oObj.getKey());
                        aValues.push(oObj.getKey());
                    }
                }
            }

            AppConfig.silly(aStatements);
            AppConfig.silly(aValues);

            oClient.query(aStatements.join(';')+';',aValues,function(err){
                if (err) {
                    oSelf._handleDbError(err,oObj,oClient,function(err){
                        if (err)
                            oSelf.dispatchResult(err,oClient,fnCallback);
                        else {
                            delete oObj.sErr;
                            oSelf.saveObject(hOpts,oObj,fnCallback,oClient);
                        }
                    });
                } else
                    oSelf.dispatchResult(err,oClient,fnCallback,oObj);
            });
        }
    });
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
                oSelf.acquire(callback,oObj.getSettings().sDbAlias);
        }
    ],function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback,oObj);
        else {
            var aStatements = [];
            var aValues = [];

            aStatements.push('DELETE FROM '+sTable+' WHERE '+oObj.getSettings().sKeyProperty+' = ?');
            aValues.push(oObj.getKey());

            var aCrossRefQMarks = [];
            var aCrossRefValues = [];
            if (oObj.getSettings().aSecondaryLookupKeys) {
                for (var i = 0; i < oObj.getSettings().aSecondaryLookupKeys.length; i++) {
                    if (oObj.get(oObj.getSettings().aSecondaryLookupKeys[i])) {
                        aCrossRefQMarks.push('?');
                        aValues.push(oObj.getClass()+':'+oObj.get(oObj.getSettings().aSecondaryLookupKeys[i]));
                    }
                }
            }

            var aSortedSetQMarks = [];
            var aSortedSetValues = [];

            var hExtras = oObj.getSettings().hExtras;
            for (var sProperty in hExtras) {
                if (hExtras[sProperty].sType == 'Object') {
                    aCrossRefQMarks.push('?');
                    aCrossRefValues.push(oObj.getClass()+':'+oObj.getKey()+':'+sProperty);
                } else if (hExtras[sProperty].sType == 'Collection') {
                    aSortedSetQMarks.push('?');
                    aSortedSetValues.push(oObj.getClass()+':'+oObj.getKey()+':'+sProperty);
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

            AppConfig.silly(aStatements);
            AppConfig.silly(aValues);

            oClient.query(aStatements.join(';')+';',aValues,function(err){
                try {
                    oSelf.dispatchResult(err,oClient,fnCallback,oObj);
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
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            if (hOpts && hOpts.sKey) {
                var sOrderBy = (hOpts.sOrderBy) ? hOpts.sOrderBy : 'nCreated';
                if (oObj.get(sOrderBy)==null || oObj.get(sOrderBy)==undefined) {
                    oSelf.dispatchResult('Score missing for '+oObj.sClass+'. Looking for \''+sOrderBy+'\' on key '+hOpts.sKey+' and found '+oObj.get(sOrderBy),oClient,fnCallback);
                } else {
                    oClient.query('INSERT INTO _SortedSetTbl (sID,nScore,RefID) VALUES (?,?,?) ON DUPLICATE KEY UPDATE nScore=?;',[hOpts.sKey,oObj.get(sOrderBy),oObj.getKey(),oObj.get(sOrderBy)],function(err){
                        oSelf.dispatchResult(err,oClient,fnCallback,oObj);
                    });
                }
            } else
                oSelf.dispatchResult('sKey missing.',oClient,fnCallback,null);
        }
    },oObj.getSettings().sDbAlias);
};
/**
 * Table validation and creation.
 * @param err
 * @param oObj
 * @param oClient
 * @param fnCallback
 * @private
 */
p._handleDbError = function(err,oObj,oClient,fnCallback) {
    var oSelf = this;
    oObj.sErr = err.code.toString();
    // Handle as many errors as we can.
    switch (err.code.toString()) {
        case 'ER_NO_SUCH_TABLE':
            oObj.nRetries = (oObj.nRetries) ? (oObj.nRetries+1) : 1;
            if (oObj.nRetries > 2)
                fnCallback(err.toString());
            else
                setImmediate(function(){
                    oSelf.confirmTable(oClient,oObj,fnCallback);
                });
            break;
        case 'ER_PARSE_ERROR':
            oObj.nRetries = (oObj.nRetries) ? (oObj.nRetries+1) : 1;
            if (oObj.nRetries > 2)
                fnCallback(err.toString());
            else
                setImmediate(function(){
                    oSelf.confirmTable(oClient,oObj,fnCallback);
                });
            break;
        case 'ER_BAD_FIELD_ERROR':
            oObj.nRetries = (oObj.nRetries) ? (oObj.nRetries+1) : 1;
            if (oObj.nRetries > 2)
                fnCallback(err.toString());
            else
                setImmediate(function(){
                    oSelf.confirmColumns(oClient,oObj,fnCallback);
                });
            break;
        default:
            AppConfig.error(err);
            fnCallback(err);
            break;
    }
};

p._checkTable = function(sTable,oClient,fnCallback) {
    oClient.query('SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = \''+this.hOpts[oClient.sDbAlias].sSchema+'\' AND TABLE_NAME = \''+sTable+'\';',function(err,aResults){
        fnCallback(err,(aResults && aResults.length > 0));
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

    AppConfig.info('Confirm table: '+sSchema+sTable);
    async.waterfall([
        function(callback) {
            oSelf._checkTable('_CrossReferenceTbl',oClient,function(err,bExists){
                if (!err && !bExists) {
                    AppConfig.info('CREATE TABLE IF NOT EXISTS '+sSchema+'`_CrossReferenceTbl` (`sID` CHAR(140) NOT NULL, RefID CHAR(100),PRIMARY KEY (`sID`))');
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
            oSelf._checkTable('_SortedSetTbl',oClient,function(err,bExists){

                if (!err && !bExists) {
                    AppConfig.info('CREATE TABLE IF NOT EXISTS '+sSchema+'`_SortedSetTbl` (`sID` CHAR(40) NOT NULL, nScore BIGINT NULL, RefID CHAR(100) NULL);ALTER TABLE `_SortedSetTbl` ADD INDEX `_SortedSetTbl_sID` (`sID` ASC);ALTER TABLE `_SortedSetTbl` ADD INDEX `_SortedSetTbl_nScore` (`nScore` ASC);ALTER TABLE `_SortedSetTbl` ADD UNIQUE INDEX `_SortedSetTbl_sID_RefID` (`sID` ASC, `RefID` ASC);');
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
            if (oObj.getSettings().sStrKeyProperty) {
                var nLength = oObj.getSettings().hProperties[oObj.getSettings().sStrKeyProperty].nLength||64;
                sKey = '`'+oObj.getSettings().sStrKeyProperty+'` CHAR('+nLength+') NOT NULL, PRIMARY KEY (`'+oObj.getSettings().sStrKeyProperty+'`)';
            } else if (oObj.getSettings().sKeyProperty)
                sKey = '`'+oObj.getSettings().sKeyProperty+'` BIGINT NOT NULL, PRIMARY KEY (`'+oObj.getSettings().sKeyProperty+'`)';

            AppConfig.info('CREATE TABLE  IF NOT EXISTS '+sSchema+'`'+sTable+'` ('+sKey+')');
            oClient.query('CREATE TABLE  IF NOT EXISTS '+sSchema+'`'+sTable+'` ('+sKey+')',function(err){
                if (!err || err.code.toString() == 'ER_TABLE_EXISTS_ERROR')
                    callback(null,true);
                else
                    callback(err);
            });
        }
    ],fnCallback);
};
/**
 * This method is used to confirm and/or create columns within a table.
 * @param oClient
 * @param oObj
 * @param fnCallback
 */
p.confirmColumns = function(oClient,oObj,fnCallback){
    var oSelf = this;
    var sTable = oObj.getSettings().sTable||oObj.sClass+'Tbl';

    var confirmColumn = function(sColumn,cb) {
        AppConfig.info('Confirm column: '+sColumn);
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
        AppConfig.silly('ALTER TABLE `'+oSelf.hOpts[oClient.sDbAlias].sSchema+'`.`'+sTable+'` ADD COLUMN `'+sColumn+'` '+sType+';');
        oClient.query('ALTER TABLE `'+oSelf.hOpts[oClient.sDbAlias].sSchema+'`.`'+sTable+'` ADD COLUMN `'+sColumn+'` '+sType+';',function(err){
            if (!err || err.code.toString() == 'ER_DUP_FIELDNAME') {
                cb();
            } else {
                cb(err);
            }
        });
    };

    if (!Base) Base = require('./../../Base');
    var oBase = Base.lookup({sClass:oObj.sClass});

    if (oBase.getSettings() && oBase.getSettings().aProperties && oBase.getSettings().aProperties.length) {
        // All tables include nCreated,nUpdated and nID;
        async.forEachLimit(oBase.getSettings().aProperties,1,confirmColumn,fnCallback);
    } else
        fnCallback('Do not know how to confirmColumns for '+oObj.sClass);

};
/**
 * Utility method for directly executing sql.
 * @param hOpts
 * @param sQuery
 * @param aValues
 * @param fnCallback
 */
p.execute = function(hOpts,sQuery,aValues,fnCallback) {
    var oSelf = this;
    var sDbAlias = (hOpts && hOpts.sDbAlias) ? hOpts.sDbAlias : 'default';
    oSelf.acquire(function(err, oClient) {
        if (err) {
            AppConfig.warn(sQuery);
            AppConfig.warn(aValues);
            AppConfig.error(err,hOpts);
            fnCallback(err);
        } else {
            AppConfig.silly(sQuery);
            AppConfig.silly(aValues);

            if (hOpts && hOpts.hDbSettings) {
                oClient = mysql.createConnection({
                    host:hOpts.hDbSettings.sHost,
                    user:hOpts.hDbSettings.sUser,
                    password:hOpts.hDbSettings.sPass,
                    database:hOpts.hDbSettings.sSchema,
                    charset:'utf8'
                });
            }

            oClient.query(sQuery, aValues, function(err,res) {
                if (err)
                    fnCallback({err:err,sQuery:sQuery,aValues:aValues});
                else
                    fnCallback(err,res);

                if (hOpts && hOpts.hDbSettings)
                    oClient.end();
                else
                    oSelf.release(oClient);
            });
        }
    },sDbAlias);
};

module.exports = new MySql();