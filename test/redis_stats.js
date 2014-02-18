var async       = require('async'),
    request     = require('request'),
    express     = require('express'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Middleware  = require('./../lib/Utils/Middleware'),
    AppConfig         = require('./../lib/AppConfig');

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
var nTestSize = 20;
var nPort = 2002; // Port on which to run api instance during test.
var server;

module.exports = {
    setUp:function(callback) {
        var self = this;
        async.series([
            function(cb) {
                self.user = Base.lookup({sClass:'User'});
                self.user.setData({
                    name:'TestUser'
                    ,email:'test@test.com'
                });
                self.user.save(cb);
            }
            //Process stats .
            ,function(callback){
                var dStart = new Date(new Date().getTime()-100000);
                var dEnd = new Date();
                AppConfig.processStats(dStart,dEnd,callback);
            }
            // Flush any previously tracked stats.
            ,function(cb) {
                AppConfig.flushStats(cb);
            }
            // Start up the api.
            ,function(cb) {
                AppConfig.init(null,function(err){
                    if (err)
                        cb(err);
                    else {
                        var exp_app = express();
                        server = exp_app.listen(nPort);
                        exp_app.use(express.bodyParser());
                        exp_app.use(Middleware.apiParser);
                        cb();
                    }
                });
            }
        ],callback);
    }
    ,tearDown:function(callback) {
        var self = this;
        async.parallel([
            function(cb) {
                self.user.delete(cb);
            }
            // Flush any previously tracked stats.
            ,function(cb) {
                AppConfig.flushStats(cb);
            }
            ,function(cb){
                if (server)
                    server.close();
                cb();
            }
        ],callback);
    }
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
//                    console.log(err);
//                    test.equal(err,'fnValidate not defined for stat: misconfigured_stat');
//                    callback();
//                });
//            }
//            ,function(callback) {
//                AppConfig.trackStat(sStat,[],function(err){
//                    console.log(err);
//                    test.equal(err,'This stat requires a User object as first param.');
//                    callback();
//                });
//            }
//        ],function(err){AppConfig.wrapTest(err,test)});
//    }
    ,middlewareStats:function(test){
        var self = this;
        // This test makes sure that the fnMiddleware function defined in the example conf.js file is running and
        // tracking the stats appropriately as API requests come in.
        test.expect(1);
        async.series([
            function(callback){
                // call the api up to nTestSize times.
                var q = async.queue(function(n,cb){
                    request.get({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey()+'/follows'},function(error){
                        if (error)
                            AppConfig.error(error);
                        cb();
                    });
                },10);
                q.drain = callback;
                for (var i = 0; i < nTestSize; i++){
                    q.push(i);
                }
            }
            //Now, let's process our stats.
            ,function(callback){
                var dStart = new Date(new Date().getTime()-100000);
                var dEnd = new Date();
                AppConfig.processStats(dStart,dEnd,callback);
            }
            // Load up the app singleton and its stat collections for each granularity.
            ,function(callback){
                AppConfig.oApp.loadExtras({
                    api_requests:{hExtras:{hour:true}}
                },callback);
            }
            // Validate our counts - which should be ONE because no matter the test size there's just one user being tracked here.
            ,function(callback) {
                var nApiRequests = (AppConfig.oApp.api_requests && AppConfig.oApp.api_requests.hour && AppConfig.oApp.api_requests.hour.first()) ? AppConfig.oApp.api_requests.hour.first().get('count') : 0;
                test.equal(nApiRequests,1);
                callback();
            }
        ],function(err){ AppConfig.wrapTest(err,test); });
    }
//    ,totalStatSuccess:function(test){
//        var sStat = 'unique_users';
//        var self = this;
//        test.expect(nTestSize+AppConfig.hStats[sStat].aGranularities.length);
//
//        async.series([
//            // First we simulate the tracking of a unique user.
//            function(callback){
//                // Do rough benchmark of time needed to store the stats.
//                var nTotal = 0;
//                var trackStat = function(n,cb){
//                    var nStart = new Date().getTime();
//                    AppConfig.trackStat(sStat,[self.user],function(err,res){
//                        nTotal += new Date().getTime()-nStart;
//                        test.deepEqual(res,[(n+1),(n+1)]);
//                        cb();
//                    });
//                };
//                var q = async.queue(trackStat,1);
//                q.drain = function(){
//                    AppConfig.log('Time per stat track (MS): '+(nTotal/nTestSize));
//                    callback();
//                };
//                for (var i = 0; i < nTestSize; i++) {
//                    q.push(i,function(err){
//                        if (err)
//                            AppConfig.error(err);
//                    });
//                }
//            }
//            // Next, we run the method that puts stats in a retrievable form.
//            ,function(callback) {
//                var dStart = new Date(new Date().getTime()-100000);
//                var dEnd = new Date();
//                AppConfig.processStats(dStart,dEnd,callback);
//            }
//            // Load up the app and its stat collection for the 'day' granularity.
//            ,function(callback){
//                var hExtras = {};
//                AppConfig.hStats[sStat].aGranularities.forEach(function(sGrain){
//                    hExtras[sStat+'_'+sGrain] = true;
//                });
//                self.oApp.loadExtras(hExtras,callback);
//            }
//            ,function(callback) {
//
//                AppConfig.hStats[sStat].aGranularities.forEach(function(sGrain){
//                    if (self.oApp[sStat+'_'+sGrain].first())
//                        test.equal(self.oApp[sStat+'_'+sGrain].first().get('count'),1);
//                    else
//                        test.equal(null,1);
//                });
//
//                callback();
//            }
//        ],function(err){AppConfig.wrapTest(err,test)});
//    }
};