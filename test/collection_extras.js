var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

/**
 * This test shows the creation of a user and a number of friends. Once the friends are created, we can look up the user and his friends in a single transaction.
 *
 * The test's setUp method creates a primary user and then creates n number of friends (where n = nTestSize, a variable you can change). The friend creation code is broken down so that
 * the writes can be crudely benchmarked. This test will print out the average write time for all User records created during the test.
 *
 * The tearDown method shows how to remove records and collections of records when using Redis as the primary source.
 *
 * @type {number}
 */

var nTestSize = 10;
var oRedisClient;
var nStartingMemory;
module.exports = {
    setUp:function(callback) {
        var oSelf = this;
        // Keep friends created during setup in an array for use later.
        oSelf.aFriends = [];
        // Also, keep track of the friend users created so we can clean them up at the end.
        oSelf.aFriendUserIDs = [];

        var nUserWriteTotal = 0;
        var nStart;
        async.series([
            function(cb){
                // Take note of amount of memory in Redis before test begins.
                App.Redis.acquire(function(err,oClient){
                    if (err)
                        cb(err);
                    else {
                        oRedisClient = oClient;
                        oRedisClient.info(function(err,res){
                            nStartingMemory = res.match(/used_memory\:([^\r]*)/)[1];
                            cb(err);
                        });
                    }
                });
            }
            ,function(cb) {
                oSelf.oUser = Base.lookup({sClass:'User'});
                oSelf.oUser.set('sName','TestUser');
                oSelf.oUser.set('sEmail','test@test.com');
                nStart = new Date().getTime();
                oSelf.oUser.save(null,cb);
            }
            ,function(cb) {
                nUserWriteTotal += new Date().getTime()-nStart;
                // Create n friend records  (n = nTestSize);
                var createFriend = function(n,callback) {
                    var oFriendUser = Base.lookup({sClass:'User'});
                    oFriendUser.set('sName','TestFriend '+n);
                    oFriendUser.set('sEmail','testfriend'+n+'@test.com');
                    nStart = new Date().getTime();
                    oFriendUser.save(null,function(err){
                        if (err)
                            callback(err);
                        else {
                            nUserWriteTotal += new Date().getTime()-nStart;
                            oSelf.aFriendUserIDs.push(oFriendUser.get('nID'));
                            var oFriend = Base.lookup({sClass:'Friend'});
                            oFriend.set('nUserID',oSelf.oUser.get('nID'));
                            oFriend.set('nFriendUserID',oFriendUser.get('nID'));
                            oFriend.set('nRank',n);
                            oFriend.save(null,function(err){
                                oSelf.aFriends.push(oFriend);
                                callback(err);
                            });
                        }
                    });
                };
                var q = async.queue(createFriend,1000);
                q.drain = cb;

                for (var n = 0; n < nTestSize; n++) {
                    q.push(n);
                }
            }
            ,function(cb) {
                console.log('User per record writes: '+Math.round(nUserWriteTotal/(nTestSize+1))+'ms');
                cb();
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        var oSelf = this;
        async.series([
            function(cb){
                oRedisClient.info(function(err,res){
                    var nEndingMemory = res.match(/used_memory\:([^\r]*)/)[1];
                    console.log('Total estimated memory used by test object keys: '+(nEndingMemory-nStartingMemory)+' bytes ('+((nEndingMemory-nStartingMemory)/1024000)+' MB)');
                    cb(err);
                });
            }
            ,function(cb){
                new Collection({sClass:'Friend',hQuery:{sWhere:'nID IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
            ,function(cb){
                new Collection({sClass:'User',hQuery:{sWhere:'nID IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
        ],callback);
    }
    ,addFriend:function(test){
        var oSelf = this;
        test.expect(2);

        var nStart;var nTotal;

        async.waterfall([
            function(cb){
                async.forEachLimit(oSelf.aFriends,100,function(oFriend,callback) {
                    oSelf.oUser.setExtra('cFriends',oFriend,callback);
                },function(err){
                    cb(err,null);
                });
            }
            ,function(o,cb){
                test.equal(oSelf.oUser.cFriends.nTotal,nTestSize);
                cb(null,null);
            }
            ,function(o,cb){
                // Now, lookup cFriends and include the oUser and oFriend properties on cFriend items.
                nStart = new Date().getTime();
                oSelf.oUser.loadExtras({cFriends:true},cb);
            }
            ,function(oUser,cb){
                nTotal = new Date().getTime()-nStart;
                console.log('Extras lookup: '+nTotal+' ms');
                test.equal(oSelf.oUser.cFriends.nTotal,nTestSize);
                cb(null,null);
            }
            ,function(o,cb){
                nStart = new Date().getTime();
                // Serialize just the user.
                var hResult = oSelf.oUser.toHash();
                nTotal = new Date().getTime() - nStart;
                console.log('Serialize just user: '+nTotal+' ms');
                // Now benchmark serializing the user and his friends.
                nStart = new Date().getTime();
                hResult = oSelf.oUser.toHash({cFriends:true});
                nTotal = new Date().getTime() - nStart;
                console.log('Serialize user & '+nTestSize+' friends: '+nTotal+' ms');

                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
};