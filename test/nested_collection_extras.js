var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

/**
 * This test creates friends on friends on friends and shows how to look up a user, his friends and his friends friends.
 *
 * @type {number}
 */

var nTestSize = 100;

module.exports = {
    setUp:function(callback) {
        var oSelf = this;

        if (nTestSize < 3)
            throw('nTestSize must be at least 3.');
        else
            async.series([
                function(cb) {
                    oSelf.oUser = Base.lookup({sClass:'User'});
                    oSelf.oUser.set('sName','TestUser');
                    oSelf.oUser.set('sEmail','test@test.com');
                    oSelf.oUser.save(null,cb);
                }
                ,function(cb) {
                    // Create n friend records  (n = nTestSize);
                    var createFriend = function(n,callback) {
                        // Create friendship between newly created user and first user, as well as with previously created user.
                        var oFriendUser;
                        async.waterfall([
                            function(cb) {
                                oFriendUser = Base.lookup({sClass:'User'});
                                oFriendUser.set('sName','TestFriend '+n);
                                oFriendUser.set('sEmail','testfriend'+n+'@test.com');
                                oFriendUser.save(null,cb);
                            }
                            ,function(oFriendUser,cb) {
                                var oFriend = Base.lookup({sClass:'Friend'});
                                oFriend.set('nUserID',oSelf.oUser.get('nID'));
                                oFriend.set('nFriendUserID',oFriendUser.get('nID'));
                                oFriend.save(null,cb);
                            }
                            ,function(oFriend,cb) {
                                oSelf.oUser.setExtra('cFriends',oFriend,cb);
                            }
                            ,function(o,cb) {
                                Base.lookup({sClass:'User',hQuery:{sEmail:'testfriend'+(n-1)+'@test.com'}},cb);
                            }
                            ,function(oLastUser,cb){
                                if (oLastUser.get('nID')) {
                                    var oFriendOfFriend = Base.lookup({sClass:'Friend'});
                                    oFriendOfFriend.set('nUserID',oFriendUser.get('nID'));
                                    oFriendOfFriend.set('nFriendUserID',oLastUser.get('nID'));
                                    oFriendOfFriend.save(null,cb);
                                } else
                                    cb(null,null);
                            }
                            ,function(oFriendOfFriend,cb){
                                if (oFriendOfFriend)
                                    oFriendUser.setExtra('cFriends',oFriendOfFriend,cb);
                                else
                                    cb();
                            }
                        ],callback);

                    };
                    var q = async.queue(createFriend,1000);
                    q.drain = cb;

                    for (var n = 0; n < nTestSize; n++) {
                        q.push(n);
                    }
                }
            ],callback);
    }
    ,tearDown:function(callback) {
        var oSelf = this;
        async.series([
            function(cb){
                // Lookup the user's friends and the user objects associated with those friend records so we can remove them.
                oSelf.oUser.loadExtras({
                    cFriends:{
                        hExtras:{
                            oFriendUser:{
                                hExtras:{
                                    cFriends:true
                                }
                            }
                        }
                    }
                },function(err){
                    if (err) {
                        cb(err);
                    } else {
                        // We don't just call the delete method on the collection because it's the oFriendUser property
                        // on each collection item that we want to remove.
                        var deleteItem = function(oItem,callback) {
                            if (oItem.oFriendUser && oItem.oFriendUser.cFriends)
                                oItem.oFriendUser.cFriends.delete(function(err){
                                    oItem.oFriendUser.delete(callback);
                                });
                            else
                                callback();
                        };
                        async.forEachLimit(oSelf.oUser.cFriends.aObjects,100,deleteItem,cb);
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
        ],callback);
    }
    ,loadFriendsOfFriends:function(test){
        var oSelf = this;
        test.expect(4);

        async.waterfall([
            function(cb){
                oSelf.oUser.loadExtras({
                    cFriends:{
                        hExtras:{
                            oFriendUser:{
                                hExtras:{
                                    cFriends:{hExtras:{
                                        oFriendUser:true
                                        ,oUser:true
                                    }}
                                }
                            }
                        }
                    }
                },cb);
            }
            ,function(o,cb){
                test.equal(oSelf.oUser.cFriends.nTotal,nTestSize);
                // The first user has no friends because there was no one before him.
                test.equal(oSelf.oUser.cFriends.first().oFriendUser.cFriends.nTotal,0);
                // The second user should have a friend.
                test.equal(oSelf.oUser.cFriends.getItem(1).oFriendUser.cFriends.nTotal,1);
                test.equal(oSelf.oUser.cFriends.getItem(oSelf.oUser.cFriends.nTotal-1).oFriendUser.cFriends.nTotal,1);

                // Print out some friendships for giggles.
                while (oSelf.oUser.cFriends.next()) {
                    if (oSelf.oUser.cFriends.getItem().oFriendUser.cFriends.nTotal) {
                        console.log(oSelf.oUser.cFriends.getItem().oFriendUser.cFriends.first().oUser.get('sName')+' is friends with '+oSelf.oUser.cFriends.getItem().oFriendUser.cFriends.first().oFriendUser.get('sName'));
                    }
                }

                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
};