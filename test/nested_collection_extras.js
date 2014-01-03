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
        var self = this;

        if (nTestSize < 2) {
            App.error('nTestSize must be at least 2.');
        } else
            async.series([
                function(cb) {
                    self.user = Base.lookup({sClass:'User'});
                    self.user.set('name','TestUser');
                    self.user.set('email','test@test.com');
                    self.user.save(null,cb);
                }
                ,function(cb) {
                    // Create n friend records  (n = nTestSize);
                    var createFriend = function(n,callback) {
                        // Create friendship between newly created user and first user, as well as with previously created user.
                        var friend_user;
                        async.waterfall([
                            function(cb) {
                                friend_user = Base.lookup({sClass:'User'});
                                friend_user.set('name','TestFriend '+n);
                                friend_user.set('email','testfriend'+n+'@test.com');
                                friend_user.save(null,cb);
                            }
                            ,function(friend_user,cb) {
                                var friend = Base.lookup({sClass:'Friend'});
                                friend.set('user_id',self.user.getNumKey());
                                friend.set('friend_id',friend_user.getNumKey());
                                friend.set('rank',n);
                                friend.save(null,cb);
                            }
                            ,function(friend,cb) {
                                self.user.setExtra('friends',friend,cb);
                            }
                            ,function(o,cb) {
                                Base.lookup({sClass:'User',hQuery:{email:'testfriend'+(n-1)+'@test.com'}},cb);
                            }
                            ,function(oLastUser,cb){
                                if (oLastUser.getNumKey()) {
                                    var friendOfFriend = Base.lookup({sClass:'Friend'});
                                    friendOfFriend.set('user_id',friend_user.getNumKey());
                                    friendOfFriend.set('friend_id',oLastUser.getNumKey());
                                    friendOfFriend.set('rank',1);
                                    friendOfFriend.save(null,cb);
                                } else
                                    cb(null,null);
                            }
                            ,function(friendOfFriend,cb){
                                if (friendOfFriend) {
                                    friend_user.setExtra('friends',friendOfFriend,cb);
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
        async.series([
            function(cb){
                new Collection({sClass:'Friend',hQuery:{sWhere:App.hClasses.Friend.sNumKeyProperty+' IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
            ,function(cb){
                new Collection({sClass:'User',hQuery:{sWhere:App.hClasses.Friend.sNumKeyProperty+' IS NOT NULL'}},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
        ],callback);
    }
    ,loadFriendsOfFriends:function(test){
        var self = this;
        test.expect(3);

        async.waterfall([
            function(cb){
                self.user.loadExtras({
                    friends:{
                        hExtras:{
                            friend_user:{
                                hExtras:{
                                    friends:{hExtras:{
                                        friend_user:true
                                        ,user:true
                                    }}
                                }
                            }
                        }
                    }
                },cb);
            }
            ,function(o,cb){
                test.equal(self.user.friends.nTotal,nTestSize);
                // The first user has no friends because there was no one before him.
                test.equal(self.user.friends.last().friend_user.friends.nTotal,0);
                // The second user should have a friend.
                test.equal(self.user.friends.first().friend_user.friends.nTotal,1);

                cb();
            }
        ],function(err){App.wrapTest(err,test)});
    }
};