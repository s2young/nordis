var async       = require('async'),
    should      = require('should'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Config      = Base.prototype.Config;

/**
 * This test shows the creation of a user and a number of follows. Once the follows are created, we can look up the user and his follows in a single transaction.
 *
 * The test's setUp method creates a primary user and then creates n number of follows (where n = nTestSize, a variable you can change). The follower creation code is broken down so that
 * the writes can be crudely benchmarked. This test will print out the average write time for all User records created during the test.
 *
 * The tearDown method shows how to remove records and collections of records when using Redis as the primary source.
 *
 * @type {number}
 */

var nTestSize = 10;
var oRedisClient;
var nStartingMemory;
// Keep follows created during setup in an array for use later.
var aFollows = [];
// Also, keep track of the follower users created so we can clean them up at the end.
var aFollowerUserIDs = [];
var user;

module.exports = {
    collection:{
        extras:{
            beforeEach:function(done) {

                var nUserWriteTotal = 0;
                var nStart;
                async.series([
                    function(cb){
                        // Take note of amount of memory in Redis before test begins.
                        Config.get('Redis').acquire(function(err,oClient){
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
                        user = Base.lookup({sClass:'User'});
                        user.set('name','TestUser');
                        user.set('email','test@test.com');
                        nStart = new Date().getTime();
                        user.save(cb);
                    }
                    ,function(cb) {
                        nUserWriteTotal += new Date().getTime()-nStart;
                        // Create n follower records  (n = nTestSize);
                        var createFollower = function(n,callback) {
                            var follower_user = Base.lookup({sClass:'User'});
                            follower_user.set('name','TestFollower '+n);
                            follower_user.set('email','testfollower'+n+'@test.com');
                            nStart = new Date().getTime();
                            follower_user.save(function(err){
                                if (err)
                                    callback(err);
                                else {
                                    nUserWriteTotal += new Date().getTime()-nStart;
                                    aFollowerUserIDs.push(follower_user.getKey());
                                    var follow = Base.lookup({sClass:'Follow'});
                                    follow.set('followed_id',user.getKey());
                                    follow.set('follower_id',follower_user.getKey());
                                    follow.set('rank',n);
                                    follow.save(function(err){
                                        aFollows.push(follow);
                                        callback(err);
                                    });
                                }
                            });
                        };
                        var q = async.queue(createFollower,1000);
                        q.drain = cb;

                        for (var n = 0; n < nTestSize; n++) {
                            q.push(n);
                        }
                    }
                    ,function(cb) {
                        Config.log('User per record writes (Redis + MySql): '+Math.round(nUserWriteTotal/(nTestSize+1))+'ms');
                        cb();
                    }
                ],done);
            }
            ,afterEach:function(done) {
                async.waterfall([
                    function(cb){
                        oRedisClient.info(cb);
                    }
                    ,function(res,cb) {
                        var nEndingMemory = res.match(/used_memory\:([^\r]*)/)[1];
                        Config.log('Total estimated memory used by test object keys: '+(nEndingMemory-nStartingMemory)+' bytes ('+((nEndingMemory-nStartingMemory)/1024000)+' MB)');

                        Collection.lookup({sClass:'User',hQuery:{email:'NOT NULL'}},cb);
                    }
                    ,function(cColl,cb) {
                        cColl.delete(cb);
                    }
                    ,function(ignore,cb){
                        var hQuery = {};
                        hQuery[Config.getClasses('Follow').sKeyProperty] = 'NOT NULL';
                        Collection.lookup({sClass:'Follow',hQuery:hQuery},cb);
                    }
                    ,function(cColl,cb) {
                        cColl.delete(cb);
                    }
                ],done);
            }
            ,addFollower:function(done){

                var nStart;var nTotal;
                async.waterfall([
                    function(cb){
                        async.forEachLimit(aFollows,100,function(follower,callback) {
                            user.setExtra('follows',follower,callback);
                        },function(err){
                            user.follows.nTotal.should.equal(nTestSize);
                            cb(err,null);
                        });
                    }
                    ,function(o,cb){
                        // Now, lookup follows and include the user and follower properties on cFollower items.
                        nStart = new Date().getTime();
                        user.loadExtras({follows:true},cb);
                    }
                    ,function(user,cb){
                        nTotal = new Date().getTime()-nStart;
                        Config.log('Extras lookup: '+nTotal+' ms');
                        user.follows.nTotal.should.equal(nTestSize);
                        cb(null,null);
                    }
                    ,function(o,cb){
                        nStart = new Date().getTime();
                        // Serialize just the user.
                        user.toHash();
                        nTotal = new Date().getTime() - nStart;
                        Config.log('Serialize just user: '+nTotal+' ms');
                        // Now benchmark serializing the user and his follows.
                        nStart = new Date().getTime();
                        user.toHash({follows:true});
                        nTotal = new Date().getTime() - nStart;
                        Config.log('Serialize user & '+nTestSize+' follows: '+nTotal+' ms');

                        cb();
                    }
                ],done);
            }
            ,removeFollowers:function(done) {

                async.waterfall([
                    function(cb){
                        async.forEachLimit(aFollows,100,function(follower,callback) {
                            user.setExtra('follows',follower,callback);
                        },function(err){
                            cb(err,null);
                        });
                    }
                    ,function(o,cb){
                        async.forEachLimit(aFollows,1,function(follower,callback) {
                            user.deleteExtra('follows',follower,callback);
                        },function(err){
                            cb(err,null);
                        });
                    }
                    ,function(o,cb){
                        user.follows.nTotal.should.equal(0);
                        cb(null,null);
                    }
                ],done);
            }
        }
    }
};