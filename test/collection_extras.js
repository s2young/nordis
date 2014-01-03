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
        var self = this;
        // Keep friends created during setup in an array for use later.
        self.aFriends = [];
        // Also, keep track of the friend users created so we can clean them up at the end.
        self.aFriendUserIDs = [];

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
                self.user = Base.lookup({sClass:'User'});
                self.user.set('name','TestUser');
                self.user.set('email','test@test.com');
                nStart = new Date().getTime();
                self.user.save(null,cb);
            }
            ,function(cb) {
                nUserWriteTotal += new Date().getTime()-nStart;
                // Create n friend records  (n = nTestSize);
                var createFriend = function(n,callback) {
                    var friend_user = Base.lookup({sClass:'User'});
                    friend_user.set('name','TestFriend '+n);
                    friend_user.set('email','testfriend'+n+'@test.com');
                    nStart = new Date().getTime();
                    friend_user.save(null,function(err){
                        if (err)
                            callback(err);
                        else {
                            nUserWriteTotal += new Date().getTime()-nStart;
                            self.aFriendUserIDs.push(friend_user.getNumKey());
                            var friend = Base.lookup({sClass:'Friend'});
                            friend.set('user_id',self.user.getNumKey());
                            friend.set('friend_id',friend_user.getNumKey());
                            friend.set('rank',n);
                            friend.save(null,function(err){
                                self.aFriends.push(friend);
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
                App.log('User per record writes (Redis + MySql): '+Math.round(nUserWriteTotal/(nTestSize+1))+'ms');
                cb();
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        async.waterfall([
            function(cb){
                oRedisClient.info(cb);
            }
            ,function(res,cb) {
                var nEndingMemory = res.match(/used_memory\:([^\r]*)/)[1];
                App.log('Total estimated memory used by test object keys: '+(nEndingMemory-nStartingMemory)+' bytes ('+((nEndingMemory-nStartingMemory)/1024000)+' MB)');

                new Collection({sClass:'User',hQuery:{sWhere:'email IS NOT NULL'}},cb);
            }
            ,function(cColl,cb) {
                cColl.delete(cb);
            }
            ,function(ignore,cb){
                new Collection({sClass:'Friend',hQuery:{sWhere:App.hClasses.Friend.sNumKeyProperty+' IS NOT NULL'}},cb);
            }
            ,function(cColl,cb) {
                cColl.delete(cb);
            }
        ],callback);
    }
    ,addFriend:function(test){
        var self = this;
        test.expect(2);
        var nStart;var nTotal;
        async.waterfall([
            function(cb){
                async.forEachLimit(self.aFriends,100,function(friend,callback) {
                    self.user.setExtra('friends',friend,callback);
                },function(err){
                    cb(err,null);
                });
            }
            ,function(o,cb){
                test.equal(self.user.friends.nTotal,nTestSize);
                cb(null,null);
            }
            ,function(o,cb){
                // Now, lookup friends and include the user and friend properties on cFriend items.
                nStart = new Date().getTime();
                self.user.loadExtras({friends:true},cb);
            }
            ,function(user,cb){
                nTotal = new Date().getTime()-nStart;
                App.log('Extras lookup: '+nTotal+' ms');
                test.equal(self.user.friends.nTotal,nTestSize);
                cb(null,null);
            }
            ,function(o,cb){
                nStart = new Date().getTime();
                // Serialize just the user.
                self.user.toHash();
                nTotal = new Date().getTime() - nStart;
                App.log('Serialize just user: '+nTotal+' ms');
                // Now benchmark serializing the user and his friends.
                nStart = new Date().getTime();
                self.user.toHash({friends:true});
                nTotal = new Date().getTime() - nStart;
                App.log('Serialize user & '+nTestSize+' friends: '+nTotal+' ms');

                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
    ,removeFriends:function(test) {
        var self = this;
        test.expect(2);
        async.waterfall([
            function(cb){
                async.forEachLimit(self.aFriends,100,function(friend,callback) {
                    self.user.setExtra('friends',friend,callback);
                },function(err){
                    cb(err,null);
                });
            }
            ,function(o,cb){
                test.equal(self.user.friends.nTotal,nTestSize);
                cb(null,null);
            }
            ,function(o,cb){
                async.forEachLimit(self.aFriends,1,function(friend,callback) {
                    self.user.deleteExtra('friends',friend,callback);
                },function(err){
                    cb(err,null);
                });
            }
            ,function(o,cb){
                test.equal(self.user.friends.nTotal,0);
                cb(null,null);
            }
        ],function(err){App.wrapTest(err,test)});
    }
};