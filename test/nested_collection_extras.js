var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    App         = require('./../lib/AppConfig');

/**
 * This test creates friends on friends on friends and shows how to look up a user, his friends and his friends friends.
 *
 * @type {number}
 */

var nTestSize = 2;

module.exports = {
    setUp:function(callback) {
        var oSelf = this;

        if (nTestSize < 2) {
            App.error('nTestSize must be at least 2.');
        } else
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
                                oFriend.set('nUserID',oSelf.oUser.getNumKey());
                                oFriend.set('nFriendUserID',oFriendUser.getNumKey());
                                oFriend.set('nRank',n);
                                oFriend.save(null,cb);
                            }
                            ,function(oFriend,cb) {
                                oSelf.oUser.setExtra('cFriends',oFriend,cb);
                            }
                            ,function(o,cb) {
                                Base.lookup({sClass:'User',hQuery:{sEmail:'testfriend'+(n-1)+'@test.com'}},cb);
                            }
                            ,function(oLastUser,cb){
                                if (oLastUser.getNumKey()) {
                                    var oFriendOfFriend = Base.lookup({sClass:'Friend'});
                                    oFriendOfFriend.set('nUserID',oFriendUser.getNumKey());
                                    oFriendOfFriend.set('nFriendUserID',oLastUser.getNumKey());
                                    oFriendOfFriend.set('nRank',1);
                                    oFriendOfFriend.save(null,cb);
                                } else
                                    cb(null,null);
                            }
                            ,function(oFriendOfFriend,cb){
                                if (oFriendOfFriend) {
                                    oFriendUser.setExtra('cFriends',oFriendOfFriend,cb);
                                } else
                                    cb();
                            }
                        ],callback);

                    };
                    var q = async.queue(createFriend,1000);
                    q.drain = cb;

                    for (var n = 1; n <= nTestSize; n++) {
                        q.push(n);
                    }
                }
            ],callback);
    }
    ,tearDown:function(callback) {
        var oSelf = this;
        async.series([
            function(cb){
                new Collection({sClass:'Friend',hQuery:{sWhere:App.hClasses.Friend.sNumericKey+' IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
            ,function(cb){
                new Collection({sClass:'User',hQuery:{sWhere:App.hClasses.Friend.sNumericKey+' IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
        ],callback);
    }
    ,loadFriendsOfFriends:function(test){
        var oSelf = this;
        test.expect(3);

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

                oSelf.oUser.cFriends.forEach(function(oFriend,nIndex){
                    console.log(oFriend.oFriendUser.get('sName')+' ('+oFriend.oFriendUser.getNumKey()+') has '+oFriend.oFriendUser.cFriends.nTotal+' friend(s).');
                });

                test.equal(oSelf.oUser.cFriends.nTotal,nTestSize);
                // The first user has no friends because there was no one before him.
                test.equal(oSelf.oUser.cFriends.last().oFriendUser.cFriends.nTotal,0);
                // The second user should have a friend.
                test.equal(oSelf.oUser.cFriends.first().oFriendUser.cFriends.nTotal,1);

                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
};