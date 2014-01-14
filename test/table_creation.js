var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    AppConfig         = require('./../lib/AppConfig');

/**
 * This test validates that Nordis will properly create tables if missing from the MySql schema.
 *
 */
module.exports = {
    setUp:function(callback) {
        // We are going to dynamically define a class so that we don't interfere with any other tests.
        // This will allow us to both create and drop the table during the test.
        // The assigned nClass will be a timestamp, to guarantee uniqueness.
        var nClass = new Date().getTime();
        AppConfig.hClasses.TempClass = {
            hProperties:{
                id:{
                    sType:'Number'
                    ,bUnique:true
                }
                ,sid:{
                    sType:'String'
                    ,bUnique:true
                    ,nLength:10
                }
            }
            ,nClass:nClass
        };
        AppConfig.processClass('TempClass');

        callback();
    }
    ,tearDown:function(callback) {
        AppConfig.MySql.execute(null,'DROP TABLE IF EXISTS `'+AppConfig.MySql.hOpts.sSchema+'`.`TempClassTbl`;',null,callback);
    }
    ,createTable:function(test){
        test.expect(1);
        async.waterfall([
            // This step should result in the creation of the TempClassTbl.
            function(cb) {
                Base.lookup({sClass:'TempClass',hQuery:{id:1}},cb);
            }
            ,function(oResult,cb){
                test.equal(oResult.getKey(),undefined);
                cb();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
    ,addColumn:function(test){
        // Models change over time and properties get added. This simulates the addition of a property to the class
        // definition and then a query on that property.  The new column gets added.
        test.expect(2);
        async.waterfall([
            // This step should result in the creation of the TempClassTbl.
            function(cb) {
                Base.lookup({sClass:'TempClass',hQuery:{id:1}},cb);
            }
            ,function(oResult,cb){
                test.equal(oResult.getKey(),undefined);
                // Let's add a property to the TempClass.aProperties and then query against it.
                AppConfig.hClasses.TempClass.hProperties.email = {
                    sType:'String'
                    ,bUnique:true
                };
                AppConfig.processClass('TempClass');
                Base.lookup({sClass:'TempClass',hQuery:{email:'demo@test.com'}},cb);
            }
            ,function(oObj,cb){
                test.equal(oObj.getKey(),undefined);
                cb();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
};