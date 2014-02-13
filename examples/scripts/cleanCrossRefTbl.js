var async       = require('async'),
    Collection  = require('./../../lib/Collection'),
    Base        = require('./../../lib/Base'),
    AppConfig   =   require('./../../lib/AppConfig');

process.env.sApp = 'cleanCrossRefTbl.js';
/**
 * This script removes any cross reference records that may be orphaned due to manual manipulation of data.
 */

AppConfig.init(null,function(){
    AppConfig.MySql.acquire(function(err,oClient){
        if (err)
            AppConfig.error(err);
        else {
            // Keep track of the sID values we're going to remove from the _CrossReferenceTbl
            async.parallel([
                // Clean up the _CrossReferenceTbl
                function(callback) {
                    var aRemove = [];
                    oClient.query('SELECT * FROM _CrossReferenceTbl;',function(err,aRows){
                        console.log('FOUND '+aRows.length+' ROW(S) IN _CrossReferenceTbl');
                        async.forEach(aRows,function(hItem,cb){
                            // The sID contains the nClass of the item and the RefID is the primary key id value.
                            var nClass = hItem.sID.split(':')[0];
                            var sClass = AppConfig.hClassMap[nClass];

                            if (!sClass)
                                console.log('Missing class for '+nClass);
                            else {
                                var sKeyProperty = AppConfig.hClasses[sClass].sKeyProperty;
                                var hQuery = {};
                                hQuery[sKeyProperty] = hItem.RefID;
                                Base.lookup({sClass:sClass,hQuery:hQuery},function(err,oObj){
                                    if (err)
                                        cb(err);
                                    else {
                                        if (!oObj.getKey())
                                            aRemove.push(hItem.RefID);
                                        cb();
                                    }
                                });
                            }
                        },function(){
                            if (aRemove.length)
                                oClient.query('DELETE FROM _CrossReferenceTbl WHERE RefID IN ('+aRemove.join(',')+')',function(err){
                                    if (!err)
                                        console.log('REMOVED '+aRemove.length+' ROW(S) IN _CrossReferenceTbl');
                                    callback(err);
                                })
                            else
                                callback();
                        });
                    });
                }
                // Clean up the _SortedSetTbl
                ,function(callback) {
                    var aRemove = [];
                    oClient.query('SELECT * FROM _SortedSetTbl;',function(err,aRows){
                        console.log('FOUND '+aRows.length+' ROW(S) IN _SortedSetTbl');
                        async.forEach(aRows,function(hItem,cb){
                            // The sID contains the nClass of the item and the RefID is the primary key id value.
                            var nClass = hItem.sID.split(':')[0];
                            var sClass = AppConfig.hClassMap[nClass];

                            if (!sClass) {
                                aRemove.push(hItem.RefID);
                                cb();
                            } else {
                                var sKeyProperty = AppConfig.hClasses[sClass].sKeyProperty;
                                var hQuery = {};
                                hQuery[sKeyProperty] = hItem.RefID;
                                Base.lookup({sClass:sClass,hQuery:hQuery},function(err,oObj){
                                    if (err)
                                        cb(err);
                                    else {
                                        if (!oObj.getKey())
                                            aRemove.push(hItem.RefID);
                                        cb();
                                    }
                                });
                            }
                        },function(){
                            if (aRemove.length)
                                oClient.query('DELETE FROM _SortedSetTbl WHERE RefID IN ('+aRemove.join(',')+')',function(err){
                                    if (!err)
                                        console.log('REMOVED '+aRemove.length+' ROW(S) IN _SortedSetTbl');
                                    callback(err);
                                })
                            else
                                callback();
                        });
                    });
                }
            ],function(err){
                if (err)
                    AppConfig.error(err);

                AppConfig.exit();
            })

        }
    })
});