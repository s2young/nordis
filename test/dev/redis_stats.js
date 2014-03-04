var async       = require('async'),
    request     = require('request'),
    express     = require('express'),
    Middleware  = require('./../../lib/Utils/Middleware'),
    Str         = require('./../../lib/Utils/String'),
    Base        = require('./../../lib/Base'),
    Collection  = require('./../../lib/Collection'),
    AppConfig         = require('./../../lib/AppConfig');

/**
 * This test is all about confirming the accuracy of the stats-tracking capabilities of Nordis. There are a couple
 * of types of stats one can track using Nordis: 1) those that can be recreated via queries of existing tables, and
 * 2) those that cannot.
 *
 * For example, you can easily determine how many new users you have by querying your users table. If you want to
 * track unique visits to a page on your site, that's a different kind of stat.  By defining your stats in your
 * configuration file you can track either type.
 *
 * These tests confirm the db-related stats are accurate.
 *
 */

var nTestSize = 10;
var dNow = new Date();
var nPort = 2002; // Port on which to run api instance during test.
var server;

module.exports = {
    setUp:function(callback) {
//        var self = this;
//        async.series([
//            //Process stats .
//            function(callback){
//                AppConfig.flushStats(callback);
//            }
//        ],callback);
        callback();
    }
//    ,aggregateCount:function(test){
//        test.expect(1);
//
//        // Pull the current count for the stat, then track a few hits, then process the stat and confirm the value changed.
//        var current_count = 0;
//        async.series([
//            // First, find out what the current count is for this stat.
//            // Let's just pull the stats for the past day.
//            function(callback){
//                Base.lookup({sClass:'Stat',hQuery:{name:'hits',year:dNow.getUTCFullYear(),month:dNow.getUTCMonth(),day:dNow.getUTCDate(),hour:null}},function(err,oStat){
//                    current_count = oStat.get('count');
//                    callback();
//                });
//            }
//            // Add as many hits as the nTestSize var tells us to.
//            ,function(callback) {
//                var aHits = [];
//                for (var n = 0; n < nTestSize; n++) {
//                    aHits.push(1);
//                }
//                async.forEach(aHits,function(n,cb){
//                    //Simulate homepage hit.
//                    AppConfig.trackStat('hits','/',cb,dNow,1);
//                },callback);
//            }
//            // Process the stats.
//            ,function(callback){
//                AppConfig.processStats(callback);
//            }
//            // Re-retrieve the stat and confirm its count has gone up by nTestSize
//            ,function(callback) {
//                Base.lookup({sClass:'Stat',hQuery:{name:'hits',year:dNow.getUTCFullYear(),month:dNow.getUTCMonth(),day:dNow.getUTCDate(),hour:null}},function(err,oStat){
//                    test.equals((oStat.get('count')-current_count),nTestSize);
//                    callback();
//                });
//            }
//        ],function(err){AppConfig.wrapTest(err,test)});
//    }
//    ,aggregateCountWithFilter:function(test){
//        test.expect(3);
//
//        // Pull the current count for the stat, then track a few hits, then process the stat and confirm the value changed.
//        var current_count = 0;
//        var current_homepage_count = 0;
//        var current_userpage_count = 0;
//        async.series([
//            // First, find out what the current count is for this stat.
//            // Let's just pull the stats for the past day.
//            function(callback){
//                Base.lookup({sClass:'Stat',hQuery:{name:'hits',year:dNow.getUTCFullYear(),month:dNow.getUTCMonth(),day:dNow.getUTCDate(),hour:null}},function(err,oStat){
//                    current_count = oStat.get('count');
//                    current_homepage_count = (oStat.getHashKey('filters','/')) ? Number(oStat.getHashKey('filters','/')) : 0;
//                    current_homepage_count = (oStat.getHashKey('filters','/user')) ? Number(oStat.getHashKey('filters','/user')) : 0;
//                    callback();
//                });
//            }
//            // Add as many hits as the nTestSize var tells us to.
//            ,function(callback) {
//                var aHits = [];
//                for (var n = 0; n < nTestSize; n++) {
//                    aHits.push(1);
//                }
//                async.forEach(aHits,function(n,cb){
//                    //Simulate two homepage hits and a user page hit.
//                    async.parallel([
//                        function(cb2) {
//                            AppConfig.trackStat('hits','/',cb2,dNow,1);
//                        }
//                        ,function(cb2) {
//                            AppConfig.trackStat('hits','/',cb2,dNow,1);
//                        }
//                        ,function(cb2) {
//                            AppConfig.trackStat('hits','/user',cb2,dNow,1);
//                        }
//                    ],cb);
//                },callback);
//            }
//            // Process the stats.
//            ,function(callback){
//                AppConfig.processStats(callback);
//            }
//            // Re-retrieve the stat and confirm its count has gone up by nTestSize
//            ,function(callback) {
//                Base.lookup({sClass:'Stat',hQuery:{name:'hits',year:dNow.getUTCFullYear(),month:dNow.getUTCMonth(),day:dNow.getUTCDate(),hour:null}},function(err,oStat){
//                    console.log('current_count: '+current_count+','+oStat.get('count'));
//                    console.log('current_homepage_count: '+current_homepage_count+','+oStat.getHashKey('filters','/'));
//                    console.log('current_userpage_count: '+current_userpage_count+','+oStat.getHashKey('filters','/user'));
//
//                    test.equals((oStat.get('count')-current_count),(nTestSize*3));
//                    test.equals((Number(oStat.getHashKey('filters','/'))-current_homepage_count),(nTestSize*2));
//                    test.equals((Number(oStat.getHashKey('filters','/user'))-current_userpage_count),nTestSize);
//                    callback();
//                });
//            }
//        ],function(err){AppConfig.wrapTest(err,test)});
//    }
//    ,uniqueStatFail:function(test) {
//        test.expect(3);
//        var sStat = 'unique_users';
//        async.series([
//            function(callback){
//                AppConfig.trackStat('stat_that_does_not_exist',[],function(err){
//                    console.log(err);
//                    test.equal(err,'Stat not configured: stat_that_does_not_exist');
//                    callback();
//                });
//            }
//            ,function(callback) {
//                AppConfig.trackStat('misconfigured_stat',[],function(err){
//                    test.equal(err,'fnValidate not defined for stat: misconfigured_stat');
//                    callback();
//                });
//            }
//            ,function(callback) {
//                console.log(sStat);
//                AppConfig.trackStat(sStat,[],function(err){
//                    console.log(err);
//                    test.equal(err,'This stat requires a User object as first param.');
//                    callback();
//                });
//            }
//        ],function(err){AppConfig.wrapTest(err,test)});
//    }
//    ,middlewareStats:function(test){
//        var self = this;
//        // This test makes sure that the fnMiddleware function defined in the example conf.js file is running and
//        // tracking the stats appropriately as API requests come in.
//        test.expect(1);
//        var current_count = 0;
//        async.series([
//            // Pre-process stats.
//            function(callback){
//                AppConfig.processStats(callback);
//            }
//            // Figure out the current count on this item.
//            ,function(callback) {
//                AppConfig.oApp.loadExtras({
//                    api_requests:{hExtras:{hour:true}}
//                },callback);
//            }
//            // Fire up a temporary api running on port 2002. This is all that's needed for a simple api with no permission implications.
//            ,function(callback) {
//                // Set the current_count.
//                current_count = (AppConfig.oApp.api_requests && AppConfig.oApp.api_requests.hour && AppConfig.oApp.api_requests.hour.first()) ? AppConfig.oApp.api_requests.hour.first().get('count') : 0;
//                AppConfig.init(null,function(err){
//                    if (err)
//                        callback(err);
//                    else {
//                        var exp_app = express();
//                        server = exp_app.listen(nPort);
//                        exp_app.use(express.bodyParser());
//                        exp_app.use(Middleware.apiParser);
//                        callback();
//                    }
//                });
//            }
//            // call the api endpoint nTestSize times.
//            ,function(callback){
//                var q = [];
//                for (var i = 0; i < nTestSize; i++){
//                    q.push(i);
//                }
//                async.forEach(q,function(n,cb){
//                    request.get({uri:'http://localhost:'+nPort+'/user/abc123/follows'},function(error){
//                        if (error)
//                            AppConfig.error(error);
//                        cb();
//                    });
//                },callback);
//
//            }
//            //Now, let's process our stats.
//            ,function(callback){
//                AppConfig.processStats(callback);
//            }
//            // Load up the app singleton and its stat collections for each granularity.
//            ,function(callback){
//                AppConfig.oApp.loadExtras({
//                    api_requests:{hExtras:{hour:true}}
//                },callback);
//            }
//            // Validate our counts - which should be ONE because no matter the test size there's just one user being tracked here.
//            ,function(callback) {
//                var nApiRequests = (AppConfig.oApp.api_requests && AppConfig.oApp.api_requests.hour && AppConfig.oApp.api_requests.hour.first()) ? AppConfig.oApp.api_requests.hour.first().get('count') : 0;
//                test.equal(nApiRequests,current_count+nTestSize);
//                callback();
//            }
//        ],function(err){ AppConfig.wrapTest(err,test); });
//    }
    ,uniqueCount:function(test){
        var cUsers = new Collection({sClass:'User'});
        test.expect(1);
        var current_count = 0;

        async.series([
            // Create the user accounts with which we'll make hits.
            function(callback) {
                var q = [];
                for (var n = 0; n < nTestSize; n++) {
                    q.push(n);
                }
                async.forEach(q,function(n,cb) {
                    var follower_user = Base.lookup({sClass:'User'});
                    follower_user.set('name','TestFollower '+n);
                    follower_user.set('email','testfollower'+n+'@test.com');
                    follower_user.save(function(err){
                        if (err)
                            callback(err);
                        else {
                            cUsers.add(follower_user);
                            cb();
                        }
                    });
                },callback);
            }
            // Next, figure out what the current_count is for the stat. So we can check the difference after pumping in some fakes.
            ,function(callback) {
                AppConfig.processStats(function(err){
                    if (err)
                        callback(err);
                    else
                        AppConfig.oApp.loadExtras({
                            active_users:{hExtras:{hour:true}}
                        },callback);
                });
            }
            // Next, trackStats for each user - randomly setting the nFakeCount to make sure that each user is only counted once.
            ,function(callback) {
                current_count = (AppConfig.oApp.active_users && AppConfig.oApp.active_users.hour && AppConfig.oApp.active_users.hour.first()) ? AppConfig.oApp.active_users.hour.first().get('count') : 0;
//                console.log('current_count:'+current_count);
                async.forEach(cUsers.aObjects,function(oUser,cb){
                    // Generate a random hit count.
                    var nFakeCount = Str.randomXToY(1,100);
                    AppConfig.trackStat('active_users',oUser,cb,new Date(),nFakeCount);

                },callback);
            }
            // Next, process the stats
            ,function(callback) {
                AppConfig.processStats(callback);
            }
            // Reload the stats.
            ,function(callback){
                AppConfig.oApp.loadExtras({
                    active_users:{hExtras:{hour:true}}
                },callback);
            }
            // Validate our counts - which should be ONE because no matter the test size there's just one user being tracked here.
            ,function(callback) {
                var nApiRequests = (AppConfig.oApp.active_users && AppConfig.oApp.active_users.hour && AppConfig.oApp.active_users.hour.first()) ? AppConfig.oApp.active_users.hour.first().get('count') : 0;
//                console.log('nApiRequests:'+nApiRequests);
                test.equal(nApiRequests,current_count+nTestSize);
                callback();
            }
            // Now remove the users.
            ,function(callback) {
                cUsers.delete(callback);
            }
        ],function(err){AppConfig.wrapTest(err,test)});
    }
};