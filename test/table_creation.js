var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Config      = require('./../lib/AppConfig');

/**
 * This test validates that Nordis will properly create tables if missing from the MySql schema.
 *
 */
module.exports = {
    mysql:{
        table_creation:{
            beforeEach:function(done) {
                // We are going to dynamically define a class so that we don't interfere with any other tests.
                // This will allow us to both create and drop the table during the test.
                // The assigned nClass will be a timestamp, to guarantee uniqueness.
                var nClass = new Date().getTime();
                Config.hClasses.TempClass = {
                    hProperties:{
                        id:{
                            sType:'Number'
                            ,bPrimary:true
                        }
                        ,sid:{
                            sType:'String'
                            ,bUnique:true
                            ,nLength:10
                        }
                    }
                    ,nClass:nClass
                };
                Config.processClass('TempClass');

                done();
            }
            ,afterEach:function(done) {
                Config.MySql.execute('DROP TABLE IF EXISTS `'+Config.MySql.hOpts.sSchema+'`.`TempClassTbl`;',null,done);
            }
            ,createTable:function(done){

                async.waterfall([
                    // This step should result in the creation of the TempClassTbl.
                    function(cb) {
                        Base.lookup({sClass:'TempClass',hQuery:{id:1}},cb);
                    }
                    ,function(oResult,cb){
                        (oResult.getKey()===null).should.be.ok;
                        cb();
                    }
                ],done);
            }
            ,addColumn:function(done){
                // Models change over time and properties get added. This simulates the addition of a property to the class
                // definition and then a query on that property.  The new column gets added.

                async.waterfall([
                    // This step should result in the creation of the TempClassTbl.
                    function(cb) {
                        Base.lookup({sClass:'TempClass',hQuery:{id:1}},cb);
                    }
                    ,function(oResult,cb){
                        (oResult.getKey()===null).should.be.ok;
                        // Let's add a property to the TempClass.aProperties and then query against it.
                        Config.hClasses.TempClass.hProperties.email = {
                            sType:'String'
                            ,bUnique:true
                        };
                        Config.processClass('TempClass');
                        Base.lookup({sClass:'TempClass',hQuery:{email:'demo@test.com'}},cb);
                    }
                    ,function(oObj,cb){
                        (oObj.getKey()===null).should.be.ok;
                        cb();
                    }
                ],done);
            }
        }
    }

};