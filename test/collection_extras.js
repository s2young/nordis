var async       = require('async'),
    should      = require('should'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Config      = require('./../lib/AppConfig');

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
var user;

module.exports = {
    collection:{
        extras:{
            beforeEach:function(done) {

                var nUserWriteTotal = 0;
                var nStart;
                async.series([
                    function(cb) {
                        Config.init(cb);
                    }
                    ,function(cb){
                        // Take note of amount of memory in Redis before test begins.
                        Config.Redis.acquire(function(err,oClient){
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
                        async.times(nTestSize,function(n,callback){
                            var follower_user = Base.lookup({sClass:'User'});
                            follower_user.set('name','TestFollower '+n);
                            follower_user.set('email','testfollower'+n+'@test.com');
                            nStart = new Date().getTime();
                            follower_user.save(function(err){
                                if (err)
                                    callback(err);
                                else {
                                    nUserWriteTotal += new Date().getTime()-nStart;
                                    var follow = Base.lookup({sClass:'Follow'});
                                    follow.set('followed_id',user.getKey());
                                    follow.set('follower_id',follower_user.getKey());
                                    follow.set('rank',n);
                                    follow.save(callback);
                                }
                            });
                        },cb)

                    }
                    ,function(cb) {
                        Config.log('User per record writes (Redis + MySql): '+Math.round(nUserWriteTotal/(nTestSize+1))+'ms');
                        setTimeout(cb,1000); // Make sure the async setExtras have time to run.
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
                        Collection.lookupAll({sClass:'User'},cb);
                    }
                    ,function(cColl,cb) {
                        cColl.delete(cb);
                    }
                    ,function(ignore,cb){
                        Collection.lookupAll({sClass:'Follow'},cb);
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
                        // Now, lookup follows and include the user and follower properties on cFollower items.
                        nStart = new Date().getTime();
                        user.loadExtras({follows:true},cb);
                    }
                    ,function(user,cb){
                        nTotal = new Date().getTime()-nStart;
                        Config.log('Extras lookup: '+nTotal+' ms');
                        user.follows.nTotal.should.equal(nTestSize);

                        if (Config.Redis.hOpts.default.bSkip)
                            user.follows.sSource.should.equal('MySql');
                        else
                            user.follows.sSource.should.equal('Redis');
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
                    // Now, look the user up along with its extras.
                    ,function(cb){
                        Base.lookupP({sClass:'User',hQuery:{id:user.getKey()},hExtras:{follows:true}})
                            .then(function(result){
                                result.getKey().should.equal(user.getKey());
                                result.follows.nTotal.should.equal(nTestSize);

                                if (Config.Redis.hOpts.default.bSkip) {
                                    result.sSource.should.equal('MySql');
                                    result.follows.sSource.should.equal('MySql');
                                } else {
                                    result.sSource.should.equal('Redis');
                                    result.follows.sSource.should.equal('Redis');
                                }
                            })
                            .then(null,Config.handleTestError)
                            .done(cb);
                    }
                ],done);
            }
            ,removeFollowers:function(done) {

                async.series([
                    function(cb){
                        user.loadExtras({follows:true},cb);
                    }
                    // Delete the follows. Which should update the related user's follows collection.
                    ,function(cb){
                        user.follows.nTotal.should.equal(nTestSize);
                        if (Config.Redis.hOpts.default.bSkip)
                            user.follows.sSource.should.equal('MySql');
                        else
                            user.follows.sSource.should.equal('Redis');
                        async.forEachOfLimit(user.follows.aObjects,1,function(follow,ind,callback) {
                            if ((follow instanceof Base)===false)
                                follow = Base.lookup({sClass:'Follow',hData:follow});
                            follow.delete(callback);
                        },cb);
                    }
                    // The next load should be free of follows.
                    ,function(cb){
                        user.loadExtras({follows:true},cb);
                    }
                    ,function(cb){
                        user.follows.nTotal.should.equal(0);
                        cb(null,null);
                    }
                ],done);
            }
        }
    }
    ,min_max:{
        before:function(done){

            async.series([
                // Create a user.
                function(callback) {
                    user = Base.lookup({sClass:'User'});
                    user.set('name','TestUser');
                    user.set('email','test@test.com');
                    user.save(callback);
                }
                // Assign random dates to our sales.
                ,function(callback) {
                    function randomDate(start, end) {
                        return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
                    }

                    dates = []; // Keep as a way to compare with what we lookup.
                    async.times(nTestSize,function(n,cb){

                        var date = randomDate(new Date(2012, 0, 1), new Date()).getTime();
                        dates.push(date);
                        var sale = Base.lookup({sClass:'Sale'});
                        sale.setData({
                            amount:n+'.00'
                            ,user_id:user.getKey()
                            ,date:date
                        });
                        sale.save(cb);

                    },function(){

                        sorted_dates = dates.sort(function(x, y){
                            return x - y;
                        });

                        callback();
                    });
                }
            ],done);

        }
        ,sort:function(done) {

            async.series([
                function(callback){
                    user.loadExtras({sales:true,sales_reverse:true},callback);
                }
                ,function(callback) {
                    should.exist(user.sales);
                    should.exist(user.sales.aObjects);
                    should.exist(user.sales_reverse);
                    should.exist(user.sales_reverse.aObjects);

                    user.sales.first().get('date').should.equal(sorted_dates[0]);

                    // Now test the reverse.
                    sorted_dates.reverse();

                    user.sales.last().get('date').should.equal(sorted_dates[0]);
                    user.sales_reverse.first().get('date').should.equal(sorted_dates[0]);

                    //console.log(JSON.stringify(user.sales.aObjects));
                    //console.log(JSON.stringify(user.sales_reverse.aObjects));
                    callback();
                }
            ],done);

        }
        ,min_max:function(done) {

            sorted_dates = dates.sort(function(x, y){
                return x - y;
            });

            async.series([
                function(callback){
                    user.loadExtras({sales:{nMin:sorted_dates[0],nMax:sorted_dates[1]}},callback);
                }
                ,function(callback) {
                    should.exist(user.sales);
                    should.exist(user.sales.aObjects);

                    user.sales.nTotal.should.equal(2);

                    callback();
                }
            ],done);

        }
    }
};