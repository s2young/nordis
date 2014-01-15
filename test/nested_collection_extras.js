var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    AppConfig         = require('./../lib/AppConfig');

/**
 * This test creates follows on a user and shows how to look up a user, his followers and his followers followers.
 *
 * @type {number}
 */

var nTestSize = 2;

module.exports = {
    setUp:function(callback) {
        var self = this;

        if (nTestSize < 2) {
            AppConfig.error('nTestSize must be at least 2.');
        } else
            async.series([
                function(cb) {
                    self.user = Base.lookup({sClass:'User'});
                    self.user.set('name','TestUser');
                    self.user.set('email','test@test.com');
                    self.user.save(cb);
                }
                ,function(cb) {
                    // Create n follower records  (n = nTestSize);
                    var createFollower = function(n,callback) {
                        // Create follow between newly created user and first user, as well as with previously created user.
                        var follower_user;
                        async.waterfall([
                            function(cb) {
                                follower_user = Base.lookup({sClass:'User'});
                                follower_user.set('name','TestFollower '+n);
                                follower_user.set('email','testfollower'+n+'@test.com');
                                follower_user.save(cb);
                            }
                            ,function(follower_user,cb) {
                                var follow = Base.lookup({sClass:'Follow'});
                                follow.set('followed_id',self.user.getKey());
                                follow.set('follower_id',follower_user.getKey());
                                follow.set('rank',n);
                                follow.save(cb);
                            }
                            ,function(follower,cb) {
                                self.user.setExtra('follows',follower,cb);
                            }
                            ,function(o,cb) {
                                Base.lookup({sClass:'User',hQuery:{email:'testfollower'+(n-1)+'@test.com'}},cb);
                            }
                            ,function(oLastUser,cb){
                                if (oLastUser.getKey()) {
                                    var followerOfFollower = Base.lookup({sClass:'Follow'});
                                    followerOfFollower.set('followed_id',follower_user.getKey());
                                    followerOfFollower.set('follower_id',oLastUser.getKey());
                                    followerOfFollower.set('rank',1);
                                    followerOfFollower.save(cb);
                                } else
                                    cb(null,null);
                            }
                            ,function(followerOfFollower,cb){
                                if (followerOfFollower) {
                                    follower_user.setExtra('follows',followerOfFollower,cb);
                                } else
                                    cb();
                            }
                        ],callback);

                    };
                    var q = async.queue(createFollower,1000);
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
                var hQuery = {};
                hQuery[AppConfig.hClasses.Follow.sNumKeyProperty] = 'NOT NULL';
                new Collection({sClass:'Follow',hQuery:hQuery},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
            ,function(cb){
                var hQuery = {};
                hQuery[AppConfig.hClasses.Follow.sNumKeyProperty] = 'NOT NULL';
                new Collection({sClass:'User',hQuery:hQuery},function(err,cColl){
                    if (err)
                        cb(err);
                    else
                        cColl.delete(cb);
                });
            }
        ],callback);
    }
    ,loadFollowersOfFollowers:function(test){
        var self = this;
        test.expect(3);

        async.waterfall([
            function(cb){
                self.user.loadExtras({
                    follows:{
                        hExtras:{
                            follower_user:{
                                hExtras:{
                                    follows:{hExtras:{
                                        follower_user:true
                                        ,followed_user:true
                                    }}
                                }
                            }
                        }
                    }
                },cb);
            }
            ,function(o,cb){
                test.equal(self.user.follows.nTotal,nTestSize);
                // The first user has no follows because there was no one before him.
                test.equal(self.user.follows.last().follower_user.follows.nTotal,0);
                // The second user should have a follower.
                test.equal(self.user.follows.first().follower_user.follows.nTotal,1);

                cb();
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
};