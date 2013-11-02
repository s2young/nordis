var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

var nTestSize = 1;
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
                            oFriend.save(null,function(err){
                                oSelf.aFriends.push(oFriend);
                                callback(err);
                            });
                        }
                    });
                };
                var q = async.queue(createFriend,10);
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
                // Lookup the user's friends and the user objects associated with those friend records so we can remove them.
                oSelf.oUser.loadExtras({cFriends:{hExtras:{oFriendUser:true}}},function(err){
                    if (err)
                        cb(err);
                    else {
                        var delFriendUser = function(oUser,cback){
                            if (oUser instanceof Base) {
                                oUser.delete(cback);
                            } else
                                cback();
                        };
                        var q = async.queue(delFriendUser,100);
                        q.drain = cb;

                        while (oSelf.oUser.cFriends.next()) {
                            if (oSelf.oUser.cFriends.getCurrent().oFriendUser)
                                q.push(oSelf.oUser.cFriends.getCurrent().oFriendUser);
                            else
                                q.push({});
                        }
                    }
                });
            }
            ,function(cb){
                // Now delete the cFriends collection.
                oSelf.oUser.cFriends.delete(cb);
            }
            ,function(cb){
                // And finally the oUser.
                oSelf.oUser.delete(cb);
            }
        ],callback)
    }
    ,addFriend:function(test){
        var oSelf = this;
        test.expect(2);

        var nStart;var nTotal;

        async.waterfall([
            function(cb){
                var addFriend = function(oFriend,callback) {
                    oSelf.oUser.setExtra('cFriends',oFriend,callback);
                };
                var q = async.queue(addFriend,1);
                q.drain = function(){
                    cb(null,null);
                };
                for (var n = 0; n < nTestSize; n++) {
                    q.push(oSelf.aFriends[n]);
                }
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