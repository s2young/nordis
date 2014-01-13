var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

var nTestSize = 10;

module.exports = {
    setUp:function(callback) {

        async.series([
            function(cb){
                var createUser = function(n,cback) {
                    var user = Base.lookup({sClass:'User'});
                    user.set('name','TestUser');
                    user.set('email','test'+n+'@test.com');
                    user.save(null,cback);
                };
                var q = async.queue(createUser,10);
                q.drain = cb;
                for (var n = 0; n < nTestSize; n++) {
                    q.push(n);
                }
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        async.parallel([
            function(cb) {
                new Collection({sClass:'User',hQuery:{sWhere:'email LIKE \'%@test.com\''}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
            ,function(cb) {
                new Collection({sClass:'Sale',hQuery:{sWhere:'id IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
        ],callback);

    }
    ,lookupViaRedis:function(test){
        test.expect(nTestSize*2);

        var nTotalTime = 0;
        var nTotalTime2 = 0;
        var lookupUser = function(n,cb) {
            var nStart = new Date().getTime();
            Base.lookup({sClass:'User',hQuery:{email:'test'+n+'@test.com'}},function(err,user){
                nTotalTime += (new Date().getTime()-nStart);
                test.equal(user.get('email'),'test'+n+'@test.com');

                // Look up via primary key.
                var nStart2 = new Date().getTime();
                var hQuery = {};
                hQuery[App.hClasses.User.sNumKeyProperty] = user.getNumKey();

                Base.lookup({sClass:'User',hQuery:hQuery},function(err,user2){
                    nTotalTime2 += (new Date().getTime()-nStart2);
                    test.equal(user2.get('email'),'test'+n+'@test.com');
                    cb();
                });
            });
        };
        var q = async.queue(lookupUser,10);
        q.drain = function(err){
            App.log('Total time (Redis): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per lookup via email;');
            App.log('Total time (Redis): '+nTotalTime2+': '+(nTotalTime2/nTestSize)+' ms per lookup via primary key;');
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
                    Base.lookup({sClass:'User',sSource:'MySql',hQuery:{email:'test'+n+'@test.com'}},callback);
                }
                ,function(user,callback){
                    nTotalTime += (new Date().getTime()-nStart);
                    test.equal(user.get('email'),'test'+n+'@test.com');

                    nStart = new Date().getTime();
                    var hQuery = {};
                    hQuery[App.hClasses.User.sNumKeyProperty] = user.getNumKey();
                    Base.lookup({sClass:'User',sSource:'MySql',hQuery:hQuery},callback);
                }
                ,function(user,callback) {
                    nTotalTime2 += (new Date().getTime()-nStart);
                    test.equal(user.get('email'),'test'+n+'@test.com');
                    callback();
                }
            ],cb);
        };
        var q = async.queue(lookupUser,10);
        q.drain = function(err){
            App.log('Total time (MySql): '+nTotalTime+': '+(nTotalTime/nTestSize)+' ms per lookup;');
            App.log('Total time (MySql): '+nTotalTime2+': '+(nTotalTime2/nTestSize)+' ms per lookup via primary key;');
            App.wrapTest(err,test);
        };

        for (var n = 0; n < nTestSize; n++) {
            q.push(n);
        }
    }
    ,lookupViaWhereClause:function(test) {
        test.expect(1);
        Base.lookup({sClass:'User',hQuery:{sWhere:'name=\'TestUser\' AND email=\'test0@test.com\''}},function(err,user){
            if (user) test.equal(user.get('email'),'test0@test.com');
            App.wrapTest(err,test);
        });
    }
    ,classOverride:function(test){
        test.expect(2);
        Base.lookup({sClass:'User',hQuery:{sWhere:'name=\'TestUser\' AND email=\'test0@test.com\''}},function(err,user){
            if (user) test.equal(user.get('email'),'test0@test.com');

            var sale = Base.lookup({sClass:'Sale'});
            sale.set('user_id',user.getNumKey());
            sale.set('amount',100.00);
            sale.save(null,function(err){
                test.equal(sale.bOverridden,true);
                App.wrapTest(err,test);
            });

        });

    }
};