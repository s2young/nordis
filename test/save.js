var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

var nTestSize = 10;
module.exports = {
    setUp:function(callback) {
        // Create empty Base object of class 'User.'
        var createUser = function(n,cb) {
            var oUser = Base.lookup({sClass:'User'});
            oUser.set('sName','TestUser');
            oUser.set('sEmail','test'+n+'@test.com');
            oUser.save(null,cb);
        };
        var q = async.queue(createUser,10);
        q.drain = callback;
        
        for (var n = 0; n < nTestSize; n++) {
            q.push(n);
        }
    }
    ,tearDown:function(callback) {
        new Collection({sClass:'User',hQuery:{sWhere:'sEmail LIKE \'%@test.com\''}},function(err,cColl){
            if (err)
                callback(err);
            else
                cColl.delete(callback);
        });
    }
    ,lookupViaRedis:function(test){
        test.expect(nTestSize*2);

        var nTotalTime = 0;
        var nTotalTime2 = 0;
        var lookupUser = function(n,cb) {
            var nStart = new Date().getTime();
            Base.lookup({sClass:'User',hQuery:{sEmail:'test'+n+'@test.com'}},function(err,oUser){
                nTotalTime += (new Date().getTime()-nStart);
                test.equal(oUser.get('sEmail'),'test'+n+'@test.com');

                // Look up via primary key.
                var nStart2 = new Date().getTime();
                Base.lookup({sClass:'User',hQuery:{nID:oUser.get('nID')}},function(err,oUser2){
                    nTotalTime2 += (new Date().getTime()-nStart2);
                    test.equal(oUser2.get('sEmail'),'test'+n+'@test.com');
                    cb();
                });
            });
        };
        var q = async.queue(lookupUser,10);
        q.drain = function(err){
            console.log('Total time (Redis): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per lookup via email;\n');
            console.log('Total time (Redis): '+nTotalTime2+': '+(nTotalTime2/nTestSize)+' ms per lookup via primary key;\n');
            App.wrapTest(err,test);
        };

        for (var n = 0; n < nTestSize; n++) {
            q.push(n);
        }
    }
    ,lookupViaMySql:function(test){
        test.expect((nTestSize*2));

        var nTotalTime = 0;
        var nTotalTime2 = 0;
        var lookupUser = function(n,cb) {
            var nStart;
            async.waterfall([
                function(callback){
                    nStart = new Date().getTime();
                    Base.lookup({sClass:'User',sSource:'MySql',hQuery:{sEmail:'test'+n+'@test.com'}},callback);
                }
                ,function(oUser,callback){
                    nTotalTime += (new Date().getTime()-nStart);
                    test.equal(oUser.get('sEmail'),'test'+n+'@test.com');

                    nStart = new Date().getTime();
                    Base.lookup({sClass:'User',sSource:'MySql',hQuery:{nID:oUser.get('nID')}},callback);
                }
                ,function(oUser,callback) {
                    nTotalTime2 += (new Date().getTime()-nStart);
                    test.equal(oUser.get('sEmail'),'test'+n+'@test.com');
                    callback();
                }
            ],cb);
        };
        var q = async.queue(lookupUser,10);
        q.drain = function(err){
            console.log('Total time (MySql): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per lookup;\n');
            console.log('Total time (MySql): '+nTotalTime2+': '+(nTotalTime2/nTestSize)+' ms per lookup via primary key;\n');
            App.wrapTest(err,test);
        };

        for (var n = 0; n < nTestSize; n++) {
            q.push(n);
        }
    }
    ,lookupViaWhereClause:function(test) {
        test.expect(1);
        Base.lookup({sClass:'User',hQuery:{sWhere:'sName=\'TestUser\' AND sEmail=\'test0@test.com\''}},function(err,oUser){
            if (oUser) test.equal(oUser.get('sEmail'),'test0@test.com');
            App.wrapTest(err,test);
        });
    }
};