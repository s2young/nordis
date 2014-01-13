var async       = require('async'),
    moment      = require('moment'),
    request     = require('request'),
    express     = require('express'),
    Base        = require('./../lib/Base'),
    Collection  = require('./../lib/Collection'),
    Middleware  = require('./../lib/Utils/Middleware'),
    App         = require('./../lib/AppConfig');

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
                self.user.set('name','TestUser');
                self.user.set('email','test@test.com');
                self.user.save(null,cb);
            }
            ,function(cb) {
                Base.lookup({sClass:'App'},function(err,oResult){
                    self.oApp = oResult;
                    cb(err);
                });
            }
            // Delete any stats tracked even incidentally by other tests.
            ,function(cb) {
                var q = async.queue(function(sProp,cback){
                    if (self.oApp[sProp] instanceof Collection) {
                        console.log('delete '+sProp);
                        self.oApp[sProp].delete(cback);
                    } else
                        cback();
                },1);
                q.drain = cb;
                for (var sProp in self.oApp) {
                    q.push(sProp);
                }
            }
            // Start up the api.
            ,function(cb) {
                App.init(null,function(err){
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
            ,function(cb) {
                var q = async.queue(function(sProp,cback){
                    if (self.oApp[sProp] instanceof Collection) {
                        console.log('delete '+sProp);
                        self.oApp[sProp].delete(cback);
                    } else
                        cback();
                },1);
                q.drain = cb;
                for (var sProp in self.oApp) {
                    q.push(sProp);
                }
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
//
//        async.series([
//            function(callback){
//                App.trackStat('stat_that_does_not_exist',[],function(err){
//                    test.equal(err,'Stat not configured: stat_that_does_not_exist');
//                    callback();
//                });
//            }
//            ,function(callback) {
//                App.trackStat('misconfigured_stat',[],function(err){
//                    test.equal(err,'fnValidate not defined for stat: misconfigured_stat');
//                    callback();
//                });
//            }
//            ,function(callback) {
//                App.trackStat(sStat,[],function(err){
//                    test.equal(err,'This stat requires a User object as first param.');
//                    callback();
//                });
//            }
//        ],function(err){App.wrapTest(err,test)});
//    }
//    ,uniqueStatSuccess:function(test) {
//        var sStat = 'unique_users';
//        var self = this;
//        var dStart;
//        var dEnd;
//
//        test.expect(nTestSize+10+365);
//        async.series([
//            // First we simulate the tracking of a unique user.
//            function(callback){
//                var nTotal = 0; // Gonna do rough benchmark of time needed to store the stats.
//                var q = async.queue(function(n,cb){
//                    var nStart = new Date().getTime();
//                    App.trackStat(sStat,[self.user],function(err,res){
//                        nTotal += new Date().getTime()-nStart;
//                        test.deepEqual(res,[(n+1),(n+1),(n+1),(n+1)]);
//                        cb();
//                    });
//                },1);
//                q.drain = function(){
//                    App.log('Time per stat track, incrementing at four different granularities - (MS): '+(nTotal/nTestSize));
//                    callback();
//                };
//                for (var i = 0; i < nTestSize; i++) {
//                    q.push(i,function(err){
//                        if (err)
//                            App.error(err);
//                    });
//                }
//            }
//            // Next, we run the method that puts stats in a retrievable form.
//            ,function(callback) {
//                dStart = new Date(new Date().getTime()-100000);
//                dEnd = new Date();
//                App.processStats(dStart,dEnd,callback);
//            }
//            // Load up the app singleton and its stat collections for each granularity.
//            ,function(callback){
//                var hExtras = {};
//                ['year','month','day','hour'].forEach(function(sGrain){
//                    hExtras[sStat+'_'+sGrain] = true;
//                });
//                self.oApp.loadExtras(hExtras,callback);
//            }
//            // Validate our counts - which should be ONE because no matter the test size there's just one user being tracked here.
//            ,function(callback) {
//                ['year','month','day','hour'].forEach(function(sGrain){
//                    if (self.oApp[sStat+'_'+sGrain] && self.oApp[sStat+'_'+sGrain].first())
//                        test.equal(self.oApp[sStat+'_'+sGrain].first().get('count'),1);
//                    else
//                        test.equal(null,1);
//                });
//                callback();
//            }
//            // Now, let's simulate a year's worth of stats, starting Jan 1, 2013.
//            ,function(callback) {
//                dStart = new Date(2013,0,1);
//                dEnd = new Date(2013,11,31);
//
//                var nTotal = 0; // Gonna do rough benchmark of time needed to store the stats.
//                var q = async.queue(function(dDate,cb){
//                    var nStart = new Date().getTime();
//                    App.trackStat(sStat,[self.user],function(err,res){
//                        nTotal += new Date().getTime()-nStart;
//                        test.deepEqual(res.length,4);
//                        cb();
//                    },dDate);
//                },1);
//                q.drain = function(){
//                    App.log('Time per stat track, incrementing at four different granularities - (MS): '+(nTotal/365));
//                    callback();
//                };
//                while (dStart <= dEnd) {
//                    q.push(dStart);
//                    var m = moment(dStart);
//                    m = m.add('days',1);
//                    dStart = new Date(m.valueOf());
//                }
//            }
//            ,function(callback) {
//                App.processStats(dStart,dEnd,callback);
//            }
//            // Load up the app singleton and its stat collections for each granularity.
//            ,function(callback){
//                var hExtras = {};
//                ['year','month','day','hour'].forEach(function(sGrain){
//                    hExtras[sStat+'_'+sGrain] = true;
//                });
//                self.oApp.loadExtras(hExtras,callback);
//            }
//            // Validate our counts - which should be ONE because no matter the test size there's just one user being tracked here.
//            ,function(callback) {
//                ['year','month','day','hour'].forEach(function(sGrain){
//
//                    if (self.oApp[sStat+'_'+sGrain].first()) {
//                        // The 'day' granularity collection should have 366 items in it, for both tests above.
//                        switch (sGrain) {
//                            case 'day':
//                                test.equal(self.oApp[sStat+'_'+sGrain].nTotal,366);
//                                break;
//                            case 'month':
//                                test.equal(self.oApp[sStat+'_'+sGrain].nTotal,13);
//                                break;
//                        }
//                        test.equal(self.oApp[sStat+'_'+sGrain].first().get('count'),1);
//                    } else
//                        test.equal(null,1);
//                });
//                callback();
//            }
//
//        ],function(err){App.wrapTest(err,test)});
//    }
    ,middlewareStats:function(test){
        var self = this;
        // This test makes sure that the fnMiddleware function defined in the example conf.js file is running and
        // tracking the stats appropriately as API requests come in.
        test.expect(2);
        async.series([
            function(callback){

                // call the api up to nTestSize times.
                var q = async.queue(function(n,cb){
                    request.post({uri:'http://localhost:'+nPort+'/user/'+self.user.getStrKey()},function(error, response, body){
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
                App.processStats(dStart,dEnd,callback);
            }
            // Load up the app singleton and its stat collections for each granularity.
            ,function(callback){
                self.oApp.loadExtras({
                    hits_day:true
                    ,api_requests_hour:true
                },callback);
            }
            // Validate our counts - which should be ONE because no matter the test size there's just one user being tracked here.
            ,function(callback) {
                var nHits = (self.oApp.hits_day && self.oApp.hits_day.first()) ? self.oApp.hits_day.first().get('count') : 0;
                test.equal(nHits,nTestSize);

                var nApiRequests = (self.oApp.api_requests_hour && self.oApp.api_requests_hour.first()) ? self.oApp.api_requests_hour.first().get('count') : 0;
                test.equal(nApiRequests,1);

                callback();
            }

        ],function(err){ App.wrapTest(err,test); });

    }
//    ,totalStatSuccess:function(test){
//        var sStat = 'unique_users';
//        var self = this;
//        test.expect(nTestSize+App.hStats[sStat].aGranularities.length);
//
//        async.series([
//            // First we simulate the tracking of a unique user.
//            function(callback){
//                // Do rough benchmark of time needed to store the stats.
//                var nTotal = 0;
//                var trackStat = function(n,cb){
//                    var nStart = new Date().getTime();
//                    App.trackStat(sStat,[self.user],function(err,res){
//                        nTotal += new Date().getTime()-nStart;
//                        test.deepEqual(res,[(n+1),(n+1)]);
//                        cb();
//                    });
//                };
//                var q = async.queue(trackStat,1);
//                q.drain = function(){
//                    App.log('Time per stat track (MS): '+(nTotal/nTestSize));
//                    callback();
//                };
//                for (var i = 0; i < nTestSize; i++) {
//                    q.push(i,function(err){
//                        if (err)
//                            App.error(err);
//                    });
//                }
//            }
//            // Next, we run the method that puts stats in a retrievable form.
//            ,function(callback) {
//                var dStart = new Date(new Date().getTime()-100000);
//                var dEnd = new Date();
//                App.processStats(dStart,dEnd,callback);
//            }
//            // Load up the app and its stat collection for the 'day' granularity.
//            ,function(callback){
//                var hExtras = {};
//                App.hStats[sStat].aGranularities.forEach(function(sGrain){
//                    hExtras[sStat+'_'+sGrain] = true;
//                });
//                self.oApp.loadExtras(hExtras,callback);
//            }
//            ,function(callback) {
//
//                App.hStats[sStat].aGranularities.forEach(function(sGrain){
//                    if (self.oApp[sStat+'_'+sGrain].first())
//                        test.equal(self.oApp[sStat+'_'+sGrain].first().get('count'),1);
//                    else
//                        test.equal(null,1);
//                });
//
//                callback();
//            }
//        ],function(err){App.wrapTest(err,test)});
//    }
};