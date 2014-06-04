var async       = require('async'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Config      = require('./../lib/AppConfig');

/**
 * This test creates follows on a user and shows how to look up a user, his followers and his followers followers.
 *
 * @type {number}
 */

var nTestSize = 20;
var user;

module.exports = {
    collection:{
        nested_extras:{
            beforeEach:function(done) {

                if (nTestSize < 2) {
                    Config.error('nTestSize must be at least 2.');
                } else
                    async.series([
                        function(cb) {
                            user = Base.lookup({sClass:'User'});
                            user.set('name','TestUser');
                            user.set('email','test@test.com');
                            user.save(cb);
                        }
                        ,function(cb) {
                            // Create n follower records  (n = nTestSize);
                            var createFollower = function(n,callback) {
                                // Create follow between newly created user and first user, as well as with previously created user.
                                var follower_user;
                                async.waterfall([
                                    function(cb) {
                                        follower_user = Base.lookup({sClass:'User'});
                                        follower_user.setData({
                                            name:'TestFollower '+n
                                            ,email:'testfollower'+n+'@test.com'
                                        });
                                        follower_user.save(cb);
                                    }
                                    ,function(follower_user,cb) {
                                        var follow = Base.lookup({sClass:'Follow'});
                                        follow.setData({
                                            followed_id:user.getKey()
                                            ,follower_id:follower_user.getKey()
                                            ,rank:n
                                        });
                                        follow.save(cb);
                                    }
                                    ,function(follower,cb) {
                                        user.setExtra('follows',follower,cb);
                                    }
                                    ,function(o,cb) {
                                        Base.lookup({sClass:'User',hQuery:{email:'testfollower'+(n-1)+'@test.com'}},cb);
                                    }
                                    ,function(oLastUser,cb){
                                        if (oLastUser.getKey()) {
                                            var followerOfFollower = Base.lookup({sClass:'Follow'});
                                            followerOfFollower.setData({
                                                followed_id:follower_user.getKey()
                                                ,follower_id:oLastUser.getKey()
                                                ,rank:1
                                            });
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
                    ],done);
            }
            ,afterEach:function(done) {
                async.series([
                    function(cb){
                        var hQuery = {};
                        hQuery[Config.getClasses('Follow').sKeyProperty] = 'NOT NULL';
                        Collection.lookup({sClass:'Follow',hQuery:hQuery},function(err,cColl){
                            if (err)
                                cb(err);
                            else
                                cColl.delete(cb);
                        });
                    }
                    ,function(cb){
                        var hQuery = {};
                        hQuery[Config.getClasses('Follow').sKeyProperty] = 'NOT NULL';
                        Collection.lookup({sClass:'User',hQuery:hQuery},function(err,cColl){
                            if (err)
                                cb(err);
                            else
                                cColl.delete(cb);
                        });
                    }
                ],done);
            }
            ,loadFollowersOfFollowers:function(done){

                async.waterfall([
                    function(cb){
                        user.loadExtras({
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
                        user.follows.nTotal.should.equal(nTestSize);
                        // The first user has no follows because there was no one before him.
                        user.follows.last().follower_user.follows.nTotal.should.equal(0);
                        // The second user should have a follower.
                        user.follows.first().follower_user.follows.nTotal.should.equal(1);
                        cb();
                    }
                ],done);
            }
        }
    }
};