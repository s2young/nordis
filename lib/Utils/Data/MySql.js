var mysql       = require('mysql'),
    async       = require('async'),
    check       = require('validator').check,
    sanitize    = require('validator').sanitize,
    poolModule  = require('generic-pool');

var App;
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
p.init = function(hSettings,fnCallback) {
    var oSelf = this;
    oSelf.hSettings = hSettings;
    oSelf.dbPool = poolModule.Pool({
        name     : 'mysql',
        create   : function(callback) {
            var c = mysql.createConnection({
                host:hSettings.sHost,
                debug:false,
                user:hSettings.sUser,
                password:hSettings.sPass,
                database:hSettings.sSchema,
                charset:'utf8',
                multipleStatements:true
            });
            callback(null, c);
        },
        destroy  : function(client) {
            client.end(function(err){
            if (err) {
                if (!App) App = require('./../../AppConfig');
                App.error(err);
            }
        })
        },
        max: hSettings.nMaxConnections,
        idleTimeoutMillis: hSettings.nTimeoutMilliseconds,
        log:hSettings.bDebugMode
    });
};
/**
 * Connection pool acquisition.
 * @param fnCallback
 */
p.acquire = function(fnCallback) {
    this.dbPool.acquire(fnCallback);
};
/**
 * Common release method just for consistency with acquire. Also helpful with debugging.
 * @param oClient
 */
p.release = function(oClient) {
    this.dbPool.release(oClient);
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
    if (err) {
        if (!App) App = require('./../../AppConfig');
        App.error(err);
    }

    if (oClient)
        oSelf.release(oClient);

    if (fnCallback)
        fnCallback(err,oResult);
};
/**
 * This method loads an object using the passed-in hQuery, which must be a single name-value
 * pair using either the primary key or a valid secondary lookup field.
 * @param hOpts
 * @param oObj
 * @param fnCallback
 */
p.load = function(hOpts,oObj,fnCallback,oClient) {
    var oSelf = this;
    async.waterfall([
        function(callback){
            if (oClient)
                callback(null,oClient);
            else
                oSelf.acquire(callback);
        }
    ],function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            // First get the object itself.
            var hQuery = oSelf.generateQuery(hOpts.hQuery,oObj);

            if (!App) App = require('./../../AppConfig');
            App.debug(hQuery.aStatements);
            App.debug(hQuery.aValues);

            async.parallel([
                function(callback) {
                    if (hQuery.aValues && hQuery.aValues.length > 0)
                        oClient.query(hQuery.aStatements.join(';'),hQuery.aValues,callback);
                    else
                        oClient.query(hQuery.aStatements.join(';')+';',null,callback);
                }
            ],function(err,aResults){
                if (aResults && aResults[0] && aResults[0][0] && aResults[0][0][0]) {
                    //oObj.setData(aResults[0][0][0],true);
                    oObj.hData = aResults[0][0][0];
                    oObj.sSource = 'MySql';
                    oSelf.dispatchResult(err,oClient,fnCallback,oObj);
                } else {
                    var sErr = '';
                    if (err)
                        sErr = err.code.toString();

                    switch (sErr) {
                        case 'ER_NO_SUCH_TABLE':
                            oSelf.confirmTable(oClient,oObj,function(err){
                                if (err)
                                    oSelf.dispatchResult(err,oClient,fnCallback,oObj);
                                else
                                    oSelf.load(hOpts,oObj,fnCallback,oClient);
                            });
                            break;
                        case 'ER_PARSE_ERROR':
                            oSelf.confirmTable(oClient,oObj,function(err){
                                if (err)
                                    oSelf.dispatchResult(err,oClient,fnCallback,oObj);
                                else
                                    oSelf.load(hOpts,oObj,fnCallback,oClient);
                            });
                            break;
                        case 'ER_BAD_FIELD_ERROR':
                            oObj.nRetries = (oObj.nRetries) ? (oObj.nRetries+1) : 1;
                            if (oObj.nRetries >= 2)
                                oSelf.dispatchResult(err,oClient,fnCallback,oObj);
                            else
                                oSelf.confirmColumns(oClient,oObj,function(err){
                                    if (err)
                                        oSelf.dispatchResult(err,oClient,fnCallback,oObj);
                                    else
                                        oSelf.load(hOpts,oObj,fnCallback,oClient);
                                });
                            break;
                        default:
                            oSelf.dispatchResult(err,oClient,fnCallback,oObj);
                            break;
                    }
                }
            });
        }
    });
};

p.generateQuery = function(hQuery,oObj,sProperty) {
    var hResult = {aStatements:[],aValues:[]};
    if (!Collection)
        Collection  = require('./../../Collection');
    if (sProperty && oObj[sProperty] instanceof Collection) {
        if (oObj[sProperty].aValues) {
            hResult.aStatements.push('SELECT * FROM '+oObj.sClass+'Tbl WHERE nID IN ('+oObj[sProperty].aValues.join(',')+')');
            delete oObj[sProperty].aValues;
        } else {

        }
    } else if (hQuery.nID) {
        // Primary key lookup. We can get the whole object because we know where to look
        hResult.aStatements.push('SELECT * FROM '+oObj.sClass+'Tbl WHERE nID = ?');
        hResult.aValues.push(hQuery.nID);
    } else if (hQuery.sWhere) {
        hResult.aStatements.push('SELECT * FROM '+oObj.sClass+'Tbl WHERE '+hQuery.sWhere);
    } else {
        // Secondary lookup, which is just a pointer to the primary key.
        for (var sLookup in hQuery) {
            hResult.aStatements.push('SELECT * FROM '+oObj.sClass+'Tbl WHERE nID = (SELECT nRefID FROM _CrossReferenceTbl WHERE sID = ?)');
            hResult.aValues.push(oObj.nClass+':'+hQuery[sLookup]);
            hResult.bSecondary = true; // TODO: Keep track of the fact that this is a secondary lookup. If it fails, maybe we can do a where clause as a backup.
            break; // Only one is allowed because secondary lookups should be unique.
        }
    }
    return hResult;
};

p.loadCollection = function(hOpts,cColl,fnCallback,oClient) {
    var oSelf = this;

    async.waterfall([
        function(callback){
            if (oClient)
                callback(null,oClient);
            else
                oSelf.acquire(callback);
        }
    ],function(err,oClient){
        // Pass down all the configuration options required to construct the collection appropriately.
        hOpts.nSize = hOpts.nSize || 0;
        hOpts.nFirstID = hOpts.nFirstID || null;
        hOpts.sOrderBy = hOpts.sOrderBy||'nID';
        hOpts.sGroupBy = hOpts.sGroupBy || null;
        hOpts.bReverse = hOpts.bReverse || false;
        hOpts.nMin = hOpts.nMin || null;

        var aStatements = [];
        var aValues = [];

        var sWhere;
        if (hOpts.hQuery && hOpts.hQuery.sWhere)
            sWhere = hOpts.hQuery.sWhere;
        else if (hOpts.hQuery) {
            var aParms = [];
            for (var sProp in hOpts.hQuery) {
                aParms.push(sProp+'=?');
                aValues.push(hOpts.hQuery[sProp]);
            }
            sWhere = aParms.join(' AND ');
        }

        var sLimit = (hOpts.nSize) ? ' LIMIT 0, ' + (Number(hOpts.nSize)+1) : '';
        var sOrderBy = (hOpts.sOrderBy) ? (hOpts.bReverse) ? ' ORDER BY '+hOpts.sOrderBy+' DESC' : ' ORDER BY '+hOpts.sOrderBy+' ASC': '';
        var sGroupBy = (hOpts.sGroupBy) ? ' GROUP BY '+hOpts.sGroupBy : '';
        var sMin = (hOpts.nMin) ? (hOpts.bReverse) ? ' AND '+hOpts.sOrderBy+' <= '+hOpts.nMin : ' AND '+hOpts.sOrderBy+' >= '+hOpts.nMin : '';

        // If you have a custom view or table name you can pass it in here:
        var sTbl = (hOpts.sView) ? hOpts.sView : cColl.sClass+'Tbl';
        if (sGroupBy)
            aStatements.push('SELECT COUNT(*) AS nTotal FROM (SELECT * FROM '+sTbl+' WHERE '+sWhere+sMin+sGroupBy+') sub');
        else
            aStatements.push('SELECT COUNT(*) AS nTotal FROM '+sTbl+' WHERE '+sWhere+sMin);

        // If nFirstID is passed in, it means that we should start there. The direction we go from there depends on
        // how the collection is supposed to be sorted and whether it's reversed.
        var sStartingScore = '';
        if (hOpts.nFirstID) {
            if (hOpts.bReverse) {
                sStartingScore = ' AND '+hOpts.sOrderBy+' <= ';
            } else {
                sStartingScore = ' AND '+hOpts.sOrderBy+' >= ';
            }
            if (hOpts.sOrderBy == 'nID')
                sStartingScore += hOpts.nFirstID;
            else
                sStartingScore += '(SELECT '+hOpts.sOrderBy+' FROM '+sTbl+' WHERE nID='+hOpts.nFirstID+')';
        }

        var sSelect = 'SELECT * FROM '+sTbl+' WHERE '+sWhere;
        aStatements.push(sSelect + sStartingScore + sGroupBy + sOrderBy + sLimit);
        aValues = aValues.concat(aValues);

        if (!App) App = require('./../../AppConfig');

        App.debug(aStatements);
        App.debug(aValues);

        oClient.query(aStatements.join(';'),aValues,function(err,aResults){
            if (aResults && aResults.length > 0) {
                cColl.nTotal = aResults[0][0].nTotal;
                if (cColl.nTotal) cColl.sSource = 'MySql';

                // Keep track of missing items. If any are found, remove them and retry this call.
                if (aResults[1]) {
                    if (hOpts.nSize && aResults[1][hOpts.nSize]) {
                        cColl.nNextID = aResults[1][hOpts.nSize].nID;
                        aResults[1].splice(-1,1);
                    }
                    cColl.setData(aResults[1]);
                }

                oSelf.dispatchResult(null,oClient,fnCallback,cColl);
            } else {
                var sErr = '';
                if (err) {
                    sErr = err.code.toString();
                    console.log(err);
                    console.log(aStatements);
                    console.log(aValues);
                }

                switch (sErr) {
                    case 'ER_NO_SUCH_TABLE':
                        oSelf.confirmTable(oClient,cColl,function(err){
                            if (err)
                                oSelf.dispatchResult(err,oClient,fnCallback,cColl);
                            else
                                oSelf.loadCollection(hOpts,cColl,fnCallback,oClient);
                        });
                        break;
                    case 'ER_PARSE_ERROR':
                        oSelf.confirmTable(oClient,cColl,function(err){
                            if (err)
                                oSelf.dispatchResult(err,oClient,fnCallback,cColl);
                            else
                                oSelf.loadCollection(hOpts,cColl,fnCallback,oClient);
                        });
                        break;
                    case 'ER_BAD_FIELD_ERROR':
                        cColl.nRetries = (cColl.nRetries) ? (cColl.nRetries+1) : 1;
                        if (cColl.nRetries >= 2) {
                            oSelf.dispatchResult(err,oClient,fnCallback,cColl);
                        } else {
                            oSelf.confirmColumns(oClient,cColl,function(err){
                                if (err)
                                    oSelf.dispatchResult(err,oClient,fnCallback,cColl);
                                else
                                    oSelf.loadCollection(hOpts,cColl,fnCallback,oClient);
                            });
                        }
                        break;
                    default:
                        oSelf.dispatchResult(err,oClient,fnCallback,cColl);
                        break;
                }
            }
        });
    });
};

p.saveObject = function(hOpts,oObj,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            var aStatements = [];
            var aValues = [];

            var aNames = [];
            var aQMarks = [];

            if (oObj.get('nID') && oObj.hDelta) {
                for (var sProp in oObj.hDelta) {
                    switch (sProp.substring(0,1)) {
                        case 'n':
                            if (oObj.get(sProp) != undefined &&  (oObj.get(sProp).toString() == '' || oObj.get(sProp).toString() == 'NaN' || oObj.get(sProp).toString() == 'null' ||oObj.get(sProp).toString() == 'undefined')) {
                                aNames.push(sProp+'=NULL');
                            } else if (isNaN(oObj.get(sProp)) === false) {
                                aNames.push(sProp+'=?');
                                aValues.push(oObj.get(sProp));
                            }
                            break;
                        case 'b':
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

                if (aNames.length)
                    aStatements.push('UPDATE '+oObj.sClass+'Tbl SET '+aNames.join(',')+' WHERE nID = '+oObj.get('nID'));

            } else {
                for (var sProp in oObj.hData) {
                    if (sProp != 'parse' && sProp != '_typeCast' && oObj.get(sProp) != undefined && oObj.get(sProp) != 'undefined' && !sProp.match(/^h/)) {
                        if (sProp.substring(0,1) == 'n') {
                            if (oObj.get(sProp).toString() == '') {
                                aNames.push(sProp);
                                aValues.push('NULL');
                                aQMarks.push('?');
                            } else if (isNaN(oObj.get(sProp))===false) {
                                aNames.push(sProp);
                                aValues.push(oObj.get(sProp));
                                aQMarks.push('?');
                            }
                        } else if (sProp.substring(0,1) == 'b') {
                            aNames.push(sProp);
                            aValues.push(oObj.get(sProp));
                            aQMarks.push('?');
                        } else {
                            aNames.push(sProp);
                            aValues.push(oObj.get(sProp).toString());
                            aQMarks.push('?');
                        }
                    }
                }

                aStatements.push('REPLACE INTO '+oObj.sClass+'Tbl ('+aNames.join(',')+') VALUES ('+aQMarks.join(',')+')');

            }

            // Store cross-reference links for any secondary key lookups.
            if (oObj.hSettings().aSecondaryLookupKeys) {
                for (var i = 0; i < oObj.hSettings().aSecondaryLookupKeys.length; i++) {
                    if (oObj.get(oObj.hSettings().aSecondaryLookupKeys[i])) {
                        aStatements.push('INSERT INTO _CrossReferenceTbl (sID,nRefID) VALUES (?,?) ON DUPLICATE KEY UPDATE nRefID=?');
                        aValues.push(oObj.nClass+':'+oObj.get(oObj.hSettings().aSecondaryLookupKeys[i]));
                        aValues.push(oObj.get('nID'));
                        aValues.push(oObj.get('nID'));
                    }
                }
            }

            if (!App) App = require('./../../AppConfig');
            App.debug(aStatements);
            App.debug(aValues);

            oClient.query(aStatements.join(';')+';',aValues,function(err,aResults){
                if (err) {
                    // Handle as many errors as we can.
                    oObj.sErr = err.code.toString();
                    switch (err.code.toString()) {
                        case 'ER_NO_SUCH_TABLE':
                            oSelf.confirmTable(oClient,oObj,function(err){
                                if (err)
                                    oSelf.dispatchResult(err,oClient,fnCallback);
                                else {
                                    oSelf.release(oClient);
                                    oSelf.saveObject(hOpts,oObj,fnCallback);
                                }
                            });
                            break;
                        case 'ER_PARSE_ERROR':
                            oSelf.confirmTable(oClient,oObj,function(err){
                                if (err)
                                    oSelf.dispatchResult(err,oClient,fnCallback);
                                else {
                                    oSelf.release(oClient);
                                    oSelf.saveObject(hOpts,oObj,fnCallback);
                                }
                            });
                            break;
                        case 'ER_BAD_FIELD_ERROR':
                            oSelf.confirmColumns(oClient,oObj,function(err){
                                if (err)
                                    oSelf.dispatchResult(err,oClient,fnCallback);
                                else {
                                    oSelf.release(oClient);
                                    oSelf.saveObject(hOpts,oObj,fnCallback);
                                }
                            });
                            break;
                        default:
                            oSelf.dispatchResult(err,oClient,fnCallback);
                            break;
                    }
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
 */
p.deleteObject = function(oObj,fnCallback){
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err) {
            oSelf.dispatchResult(err,oClient,fnCallback,oObj);
        } else {
            var aStatements = [];
            var aValues = [];

            aStatements.push('DELETE FROM '+oObj.sClass+'Tbl WHERE nID = ?');
            aValues.push(oObj.get('nID'));

            var aCrossRefQMarks = [];
            var aCrossRefValues = [];
            if (oObj.hSettings().aSecondaryLookupKeys) {
                for (var i = 0; i < oObj.hSettings().aSecondaryLookupKeys.length; i++) {
                    if (oObj.get(oObj.hSettings().aSecondaryLookupKeys[i])) {
                        aCrossRefQMarks.push('?');
                        aValues.push(oObj.nClass+':'+oObj.get(oObj.hSettings().aSecondaryLookupKeys[i]));
                    }
                }
            }

            var aSortedSetQMarks = [];
            var aSortedSetValues = [];

            var hExtras = oObj.hSettings().hExtras;
            for (var sProperty in hExtras) {
                if (hExtras[sProperty].sType == 'Object') {
                    aCrossRefQMarks.push('?');
                    aCrossRefValues.push(oObj.nClass+':'+oObj.get('nID')+':'+sProperty);
                } else if (hExtras[sProperty].sType == 'Collection') {
                    aSortedSetQMarks.push('?');
                    aSortedSetValues.push(oObj.nClass+':'+oObj.get('nID')+':'+sProperty);
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

            if (!App) App = require('./../../AppConfig');
            App.debug(aStatements);
            App.debug(aValues);

            oClient.query(aStatements.join(';')+';',aValues,function(err,res){
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
                if (oObj.get(sOrderBy)==null || oObj.get(sOrderBy)==undefined)
                    oSelf.dispatchResult('nScore missing for '+oObj.sClass+'. Looking for '+sOrderBy+' on key '+hOpts.sKey,oClient,fnCallback);
                else {
                    oClient.query('INSERT INTO _SortedSetTbl (sID,nScore,nRefID) VALUES (?,?,?) ON DUPLICATE KEY UPDATE nScore=?;',[hOpts.sKey,oObj.get(sOrderBy),oObj.get('nID'),oObj.get(sOrderBy)],function(err,res){
                        oSelf.dispatchResult(err,oClient,fnCallback,oObj);
                    });
                }
            } else
                oSelf.dispatchResult('sKey missing.',oClient,fnCallback);
        }
    });
};
/**
 * Table validation and creation.
 * @param sTable
 * @param oClient
 * @param fnCallback
 * @private
 */
p._checkTable = function(sTable,oClient,fnCallback) {
    oClient.query('SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = \''+this.hSettings.sSchema+'\' AND TABLE_NAME = \''+sTable+'\';',function(err,aResults){
        fnCallback(err,(aResults.length > 0));
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
    async.waterfall([
        function(callback) {
            oSelf._checkTable('_CrossReferenceTbl',oClient,function(err,bExists){
                if (!err && !bExists)
                    oClient.query('CREATE TABLE `_CrossReferenceTbl` (`sID` CHAR(140) NOT NULL, nRefID BIGINT NULL,PRIMARY KEY (`sID`))',function(err,res){
                        callback(err,true);
                    });
                else
                    callback(err,true);
            });
        },
        function(bExists,callback) {
            oSelf._checkTable('_SortedSetTbl',oClient,function(err,bExists){
                if (!err && !bExists)
                    oClient.query('CREATE TABLE `_SortedSetTbl` (`sID` CHAR(40) NOT NULL, nScore BIGINT NULL, nRefID BIGINT NULL);ALTER TABLE `_SortedSetTbl` ADD INDEX `_SortedSetTbl_sID` (`sID` ASC);ALTER TABLE `_SortedSetTbl` ADD INDEX `_SortedSetTbl_nScore` (`nScore` ASC);ALTER TABLE `_SortedSetTbl` ADD UNIQUE INDEX `_SortedSetTbl_sID_nRefID` (`sID` ASC, `nRefID` ASC);',function(err,res){
                        callback(err,true);
                    });
                else
                    callback(err,true);
            });
        },
        function(bExists,callback){
            oClient.query('SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = \''+oSelf.hSettings.sSchema+'\' AND TABLE_NAME = \''+oObj.sClass+'Tbl\';',function(err,aResults){
                async.parallel([
                    function(callback) {
                        if (oObj.sErr == 'ER_NO_SUCH_TABLE' || !aResults || aResults.length == 0) {
                            oClient.query('CREATE TABLE `'+oObj.sClass+'Tbl` (`nID` BIGINT NOT NULL, PRIMARY KEY (`nID`))',callback);
                        } else
                            callback();
                    }
                ],function(err){
                    oSelf.confirmColumns(oClient,oObj,callback);
                });
            });
        }
    ],fnCallback);
};

p.zrem = function(sKey,aKeys,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function(err,oClient){
        if (err)
            oSelf.dispatchResult(err,oClient,fnCallback);
        else {
            var sID = aKeys.join('').replace(/([^:]*):/,'');
            oClient.query('DELETE FROM _SortedSetTbl WHERE sID=? AND nRefID=?;',[sKey,sID],function(err,res){
                oSelf.dispatchResult(err,oClient,fnCallback,res);
            });
        }
    });
};

p.confirmColumns = function(oClient,oObj,fnCallback){
    var oSelf = this;

    var confirmColumn = function(sColumn,cb) {
        if (!sColumn)
            cb();
        else {
            oClient.query('SELECT * FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = \''+oSelf.hSettings.sSchema+'\' AND TABLE_NAME = \''+oObj.sClass+'Tbl\' AND COLUMN_NAME = \''+sColumn+'\';',function(err2,aResults){
                if (err2)
                    cb(err2);
                else if (aResults.length == 0) {
                    var sType;
                    switch (sColumn.substring(0,1)) {
                        case 's':
                            sType = 'TEXT NULL';
                            break;
                        case 'n':
                            if (sColumn.match(/^(nLat|nLon)$/))
                                sType = 'DECIMAL(10,7) NULL';
                            else if (sColumn == 'nFeatureSortOrder')
                                sType = 'BIGINT DEFAULT 4';
                            else
                                sType = 'BIGINT NULL';
                            break;
                        case 'b':
                            sType = 'TINYINT DEFAULT 0';
                            break;
                    }
                    oClient.query('ALTER TABLE `'+oObj.sClass+'Tbl` ADD COLUMN `'+sColumn+'` '+sType+' NULL;',cb);
                } else {
                    cb();
                }
            });
        }
    };

    var q = async.queue(confirmColumn,1);
    q.drain = fnCallback;

    var hData;

    if (oObj.aObjects && oObj.aObjects.length > 0) {
        hData = (oObj.aObjects[0] && oObj.aObjects[0].hData) ? oObj.aObjects[0].hData : oObj.aObjects[0];
    } else if (oObj.hData) {
        hData = oObj.hData;
    }

    if (hData) {
        for (var sKey in oObj.hData) {
            if (!sKey.match(/^(nID|parse|_typeCast)$/))
                q.push(sKey);
        }
    } else {
        if (!Base)
            Base  = require('./../../Base');
        var oBase = Base.lookup({sClass:oObj.sClass});
        if (oBase.hSettings() && oBase.hSettings().aProperties && oBase.hSettings().aProperties.length) {

            for (var i = 0; i < oBase.hSettings().aProperties.length; i++) {
                q.push(oBase.hSettings().aProperties[i]);
            }

        } else {
            throw('Do not know how to confirmColumns for '+oObj.sClass);
        }
    }
    q.push('');
};

p.execute = function(hOpts,sQuery,aValues,fnCallback) {
    var oSelf = this;
    oSelf.dbPool.acquire(function(err, oClient) {
        if (!App) App = require('./../../AppConfig');
        if (err) {
            App.error(err,hOpts);
            fnCallback(err);
        } else {
            App.debug(sQuery);
            App.debug(aValues);

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
    });
};

/**
 * This method merges all sorted sets matching the passed-in keys. Used for news presentation.
 * @param aKeys
 * @param fnCallback
 */
p.zmerge = function(hOpts,cColl,fnCallback) {
    var oSelf = this;
    oSelf.acquire(function (err, oClient) {
        if (err)
            oSelf.dispatchError(err, oClient, fnCallback);
        else {
            var aStatements = [];
            var aValues = [];

            cColl.nIndex = cColl.nIndex || 0;
            cColl.nSize = cColl.nSize || 0;

            var sCount = 'SELECT COUNT(*) AS nTotal FROM _SortedSetTbl S WHERE S.sID IN (\''+hOpts.aKeys.join('\',\'')+'\')';
            var sOrderBy = (hOpts.bReverse) ? ' ORDER BY S.nScore DESC' : ' ORDER BY S.nScore ASC';

            async.waterfall([
                function(callback){
                    if (hOpts.nFirstID)
                        oClient.query('SELECT S.nScore FROM _SortedSetTbl S WHERE S.sID IN (\''+hOpts.aKeys.join('\',\'')+'\') AND S.nRefID='+hOpts.nFirstID+sOrderBy,null,function(err,aResults){
                            hOpts.nMin = aResults[0].nScore;
                            callback(err,null);
                        });
                    else
                        callback(null,null);
                },
                function(nuttin,callback) {
                    var sMin = (hOpts.nMin) ? (hOpts.bReverse) ? ' AND S.nScore <= '+hOpts.nMin : ' AND S.nScore >= '+hOpts.nMin : '';
                    var sLimit = '';
                    if (cColl.nSize) {
                        if (cColl.nIndex)
                            sLimit = ' LIMIT ' + (cColl.nIndex * cColl.nSize) + ', ' + (Number(cColl.nSize)+1);
                        else
                            sLimit = ' LIMIT 0, ' + (Number(cColl.nSize)+1);
                    }
                    var sWhere = 'SELECT T.*,S.nScore,S.nRefID AS nRefID FROM '+cColl.sClass+'Tbl T RIGHT OUTER JOIN _SortedSetTbl S ON T.nID = S.nRefID WHERE S.sID IN (\''+hOpts.aKeys.join('\',\'')+'\') '+sMin+sOrderBy+sLimit+';';
                    oClient.query(sCount+sMin+';'+sWhere+';',null,callback);
                }
            ],function(err,aResults){
                if (err)
                    oSelf.dispatchResult(err,oClient,fnCallback,cColl);
                else {
                    var aMissingIds = [];
                    var aMissingIdQMarks = [];

                    if (aResults[0] && aResults[0][0] && aResults[0][0].nTotal)
                        cColl.nTotal = aResults[0][0].nTotal;

                    if (aResults[1]) {
                        for (var i = 0; i < aResults[1].length; i++) {
                            if (!aResults[1][i] || !aResults[1][i].nID) {
                                aMissingIdQMarks.push('?');
                                aMissingIds.push(aResults[1][i].nRefID);
                            }
                        }
                    }

                    if (aMissingIds.length > 0) {
                        cColl.empty();
                        var sCleanUp = 'DELETE FROM _SortedSetTbl WHERE nRefID IN ('+aMissingIdQMarks.join(',')+');';
                        oClient.query(sCleanUp,aMissingIds,function(err,res){
                            oSelf.release(oClient);
                            oSelf.zmerge(hOpts,cColl,fnCallback);
                        });
                    } else {
                        if (aResults[1])
                            cColl.setData(aResults[1]);
                        oSelf.dispatchResult(null,oClient,fnCallback,cColl);
                    }
                }
            });
        }
    });
};

module.exports = new MySql();