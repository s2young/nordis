var async       = require('async'),
    request     = require('request'),
    moment      = require('moment-timezone'),
    should      = require('should'),
    express     = require('express'),
    bodyParser  = require('body-parser'),
    Config      = require('./../lib/AppConfig'),
    Base        = require('./../lib/Base'),
    Metric      = require('./../lib/Metric'),
    Collection  = require('./../lib/Collection'),
    Middleware  = require('./../lib/Utils/Middleware');

/**
 * This test is all about confirming the accuracy of the stats-tracking capabilities of Nordis. There are a couple
 * of types of stats one can track using Nordis: 1) those that can be recreated via queries of existing tables, and
 * 2) those that are stored in nordis and cannot be recreated from the data model directly.
 *
 * For example, you can easily determine how many new users you have by querying your users table. If you want to
 * track unique visits to a page on your site, that's a different kind of stat.  By defining your stats in your
 * configuration file you can track either type.
 *
 * These tests confirm the db-related stats are accurate.
 *
 */

var nTestSize = 10;
var nPort = 10002; var server;
var dNow = new Date();

module.exports = {
    stats:{
        db:{
            beforeEach:function(done) {
                async.series([
                    function(callback) {
                        Metric.flush(callback);
                    }
                    ,function(callback) {
                        // Next, fire up a temporary api running on port 2002. This is all that's needed for a simple api with no permission implications.
                        Config.init(null,function(err){
                            if (err)
                                callback(err);
                            else {
                                var exp_app = express();
                                server = exp_app.listen(nPort);
                                exp_app.use(bodyParser.json({limit: '1mb'}))
                                exp_app.use(bodyParser.urlencoded({extended:true}))
                                exp_app.use(Middleware.apiParser);
                                callback();
                            }
                        });
                    }
                ],done);
            }
            ,afterEach:function(done) {
                async.series([
                    function(callback) {
                        Config.MySql.execute('DELETE FROM UserTbl WHERE name = ?',[dNow.getTime()],callback);
                    }
                    ,function(callback) {
                        Config.MySql.execute('DELETE FROM _CrossReferenceTbl',null,callback);
                    }
                    ,function(callback) {
                        if (server)
                            server.close();
                        callback();
                    }
                ],done);
            }
            ,userAlltime:function(done){
                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            q.push(n);
                        }
                        async.forEachOfLimit(q,1,function(n,ind,cb) {
                            var user = Base.lookup({sClass:'User'});
                            user.set('name',dNow.getTime());
                            user.set('email','testfollower'+n+'@test.com');
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process(callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',hMetrics:{new_users:{alltime:true}}})
                            .then(function(oStat){
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nTestSize);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{hMetrics:{new_users:{alltime:true}}})
                            .then(function(hStat){
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nTestSize);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
            ,userByYear:function(done){
                var dStart = moment.utc().subtract(nTestSize,'years').startOf('year');
                var dEnd = dStart.clone();
                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            q.push({
                                name:dNow.getTime()
                                ,email:'testfollower'+n+'@test.com'
                                ,created:dEnd.valueOf()
                            });
                            if (n < (nTestSize-1)) dEnd.add(1,'year');
                        }
                        async.forEachOf(q,function(hData,ind,cb) {
                            var user = Base.lookup({sClass:'User',hData:hData});
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process({dStart:dStart,dEnd:dEnd,sGrain:'year'},callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,year:true}}})
                            .then(function(oStat){
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nTestSize);

                                should.exist(oStat.new_users.year);
                                should.exist(oStat.new_users.year.nTotal);
                                if (oStat.new_users.year.nTotal)
                                    while (oStat.new_users.year.next()) {
                                        oStat.new_users.year.getItem().get('nCount').should.equal(1);
                                    }
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,year:true}}})
                            .then(function(hStat){
                                // validate alltime
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nTestSize);
                                // validate year
                                should.exist(hStat.new_users.year);
                                should.exist(hStat.new_users.year.nTotal);
                                should.exist(hStat.new_users.year.aObjects);
                                hStat.new_users.year.aObjects.forEach(function(item) {
                                    item.nCount.should.equal(1);
                                });
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
            ,userByMonth:function(done){
                var dStart = moment.utc().subtract(nTestSize,'months').startOf('month');
                var dEnd = dStart.clone();
                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            q.push({
                                name:dNow.getTime()
                                ,email:'testfollower'+n+'@test.com'
                                ,created:dEnd.valueOf()
                            });
                            if (n < (nTestSize-1)) dEnd.add(1,'month');
                        }
                        async.forEachOf(q,function(hData,ind,cb) {
                            var user = Base.lookup({sClass:'User',hData:hData});
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process({dStart:dStart,dEnd:dEnd,sGrain:'month'},callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,month:true}}})
                            .then(function(oStat){
                                // validate alltime
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nTestSize);
                                // The 'month' grain does not exist because it's not supported on this stat.
                                should.not.exist(oStat.new_users.month);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,month:true}}})
                            .then(function(hStat){
                                // validate alltime
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nTestSize);
                                // validate month, which shouldn't exist.
                                should.not.exist(hStat.new_users.month);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
            ,userByDay:function(done){
                var dStart = moment.utc().subtract(nTestSize,'days').startOf('day');
                var dEnd = dStart.clone();
                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            q.push({
                                name:dNow.getTime()
                                ,email:'testfollower'+n+'@test.com'
                                ,created:dEnd.valueOf()
                            });
                            if (n < (nTestSize-1)) dEnd.add(1,'day');
                        }
                        async.forEachOf(q,function(hData,ind,cb) {
                            var user = Base.lookup({sClass:'User',hData:hData});
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process({dStart:dStart,dEnd:dEnd,sGrain:'day'},callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,day:true}}})
                            .then(function(oStat){
                                // validate alltime
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nTestSize);


                                should.exist(oStat.new_users.day);
                                should.exist(oStat.new_users.day.nTotal);
                                oStat.new_users.day.nTotal.should.equal(nTestSize);
                                while (oStat.new_users.day.next()) {
                                    oStat.new_users.day.getItem().get('nCount').should.equal(1);
                                }
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,day:true}}})
                            .then(function(hStat){
                                // validate alltime
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nTestSize);

                                // validate day stats
                                should.exist(hStat.new_users.day);
                                should.exist(hStat.new_users.day.nTotal);
                                should.exist(hStat.new_users.day.aObjects);
                                hStat.new_users.day.nTotal.should.equal(nTestSize);

                                hStat.new_users.day.aObjects.forEach(function(item) {
                                    item.nCount.should.equal(1);
                                });
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
            ,userByHour:function(done){
                var dStart = moment.utc().subtract(nTestSize,'hours').startOf('hour');
                var dEnd = dStart.clone();
                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            q.push({
                                name:dNow.getTime()
                                ,email:'testfollower'+n+'@test.com'
                                ,created:dEnd.valueOf()
                            });
                            if (n < (nTestSize-1)) dEnd.add(1,'hour');
                        }
                        async.forEachOf(q,function(hData,ind,cb) {
                            var user = Base.lookup({sClass:'User',hData:hData});
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process({dStart:dStart,dEnd:dEnd,sGrain:'hour'},callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,hour:true}}})
                            .then(function(oStat){
                                // validate alltime
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nTestSize);

                                should.exist(oStat.new_users.hour);
                                should.exist(oStat.new_users.hour.nTotal);
                                oStat.new_users.hour.nTotal.should.equal(nTestSize);
                                while (oStat.new_users.hour.next()) {
                                    oStat.new_users.hour.getItem().get('nCount').should.equal(1);
                                }
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,hour:true}}})
                            .then(function(hStat){
                                // validate alltime
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nTestSize);

                                // validate hour stats
                                should.exist(hStat.new_users.hour);
                                should.exist(hStat.new_users.hour.nTotal);
                                should.exist(hStat.new_users.hour.aObjects);
                                hStat.new_users.hour.nTotal.should.equal(nTestSize);

                                hStat.new_users.hour.aObjects.forEach(function(item) {
                                    item.nCount.should.equal(1);
                                });
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
            ,userAllGrains:function(done){
                this.timeout(30000);

                var dStart = moment.utc().subtract(1,'months').startOf('months');
                var dEnd = moment.utc().startOf('day');
                var nTotal = 0;

                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var dDate = dStart.clone();
                        var q = [];
                        while (dDate <= dEnd) {
                            q.push({
                                name:dNow.getTime()
                                ,email:'testfollower'+nTotal+'@test.com'
                                ,created:dDate.valueOf()
                            });
                            dDate.add(1,'hour');
                            nTotal++;
                        }
                        async.forEachOfLimit(q,100,function(hData,ind,cb) {
                            var user = Base.lookup({sClass:'User',hData:hData});
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process({dStart:dStart,dEnd:dEnd},callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,hour:true}}})
                            .then(function(oStat){
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nTotal);

                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,hour:true}}})
                            .then(function(hStat){
                                // validate alltime
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nTotal);

                                // validate hour stats
                                should.exist(hStat.new_users.hour);
                                should.exist(hStat.new_users.hour.nTotal);
                                should.exist(hStat.new_users.hour.aObjects);
                                hStat.new_users.hour.nTotal.should.equal(nTotal);

                                hStat.new_users.hour.aObjects.forEach(function(item) {
                                    item.nCount.should.equal(1);
                                });
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
        }
        ,db_filtered:{
            beforeEach:function(done) {
                async.series([
                    function(callback) {
                        Metric.flush(callback);
                    }
                    ,function(callback) {
                        // Next, fire up a temporary api running on port 2002. This is all that's needed for a simple api with no permission implications.
                        Config.init(null,function(err){
                            if (err)
                                callback(err);
                            else {
                                var exp_app = express();
                                server = exp_app.listen(nPort);
                                exp_app.use(bodyParser.json({limit: '1mb'}))
                                exp_app.use(bodyParser.urlencoded({extended:true}))
                                exp_app.use(Middleware.apiParser);
                                callback();
                            }
                        });
                    }
                ],done);
            }
            ,afterEach:function(done) {
                async.series([
                    function(callback) {
                        Config.MySql.execute('DELETE FROM UserTbl WHERE name = ?',[dNow.getTime()],callback);
                    }
                    ,function(callback) {
                        if (server)
                            server.close();
                        callback();
                    }
                ],done);
            }
            ,userAlltime:function(done){
                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            q.push(n);
                        }
                        async.forEachOfLimit(q,10,function(n,ind,cb) {
                            var user = Base.lookup({sClass:'User'});
                            user.set('name',dNow.getTime());
                            user.set('email','testfollower'+n+'@test.com');
                            user.set('client','client'+n);
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process(callback);
                    }
                    // Get total count, no filter.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',hMetrics:{new_users:{alltime:true}}})
                            .then(function(oStat){
                                var new_count;
                                if (oStat.new_users && oStat.new_users.alltime)
                                    new_count = oStat.new_users.alltime.get('nCount');
                                nTestSize.should.equal(new_count);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Now, process for the specific filter.
                    ,function(callback) {
                        Metric.process({sFilter:'client1,client5,client9'},callback);
                    }
                    // Get filtered totals.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',sFilter:'client1,client5,client9',hMetrics:{new_users:{alltime:true}}})
                            .then(function(oStat){
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(3);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{sFilter:'client1,client5,client9',hMetrics:{new_users:{alltime:true}}})
                            .then(function(hStat){
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(3);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
            ,userByYear:function(done){
                var dStart = moment.utc().subtract(nTestSize,'years').startOf('year');
                var dEnd = dStart.clone();
                var nTotal = 0;
                async.series([
                    // Create the user accounts with which we'll make hits.  Half of them will be
                    // assigned to clientA and others to clientB.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            var client = (n%2) ? 'clientA' : 'clientB';
                            q.push({
                                name:dNow.getTime()
                                ,email:'testfollower'+n+'@test.com'
                                ,created:dEnd.valueOf()
                                ,client:client
                            });
                            if (n%2) nTotal++;
                            if (n < (nTestSize-1)) dEnd.add(1,'year');
                        }

                        async.forEachOf(q,function(hData,ind,cb) {
                            var user = Base.lookup({sClass:'User',hData:hData});
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process({sFilter:'clientA',dStart:dStart,dEnd:dEnd,sGrain:'year'},callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',sFilter:'clientA',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,year:true}}})
                            .then(function(oStat){
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nTotal);

                                should.exist(oStat.new_users.year);
                                should.exist(oStat.new_users.year.nTotal);
                                var n = 0;
                                while (oStat.new_users.year.next()) {
                                    if (n%2) oStat.new_users.year.getItem().get('nCount').should.equal(1);
                                }
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{sFilter:'clientA',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,year:true}}})
                            .then(function(hStat){
                                // validate alltime
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nTotal);
                                // validate year
                                should.exist(hStat.new_users.year);
                                should.exist(hStat.new_users.year.nTotal);
                                should.exist(hStat.new_users.year.aObjects);
                                var n = 0;
                                hStat.new_users.year.aObjects.forEach(function(item) {
                                    if (n%2) item.nCount.should.equal(1);
                                });
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
            ,userByMonth:function(done){
                var dStart = moment.utc().subtract(nTestSize,'months').startOf('month');
                var dEnd = dStart.clone();
                var nTotal = 0;
                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            var client = (n%2) ? 'clientA':'clientB';
                            q.push({
                                name:dNow.getTime()
                                ,email:'testfollower'+n+'@test.com'
                                ,created:dEnd.valueOf()
                                ,client:client
                            });
                            if (n%2) nTotal++;
                            if (n < (nTestSize-1)) dEnd.add(1,'month');
                        }
                        async.forEachOf(q,function(hData,ind,cb) {
                            var user = Base.lookup({sClass:'User',hData:hData});
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process({sFilter:'clientA',dStart:dStart,dEnd:dEnd,sGrain:'month'},callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',sFilter:'clientA',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,month:true}}})
                            .then(function(oStat){
                                // validate alltime
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nTotal);
                                // The 'month' grain does not exist because it's not supported on this stat.
                                should.not.exist(oStat.new_users.month);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,month:true}}})
                            .then(function(hStat){
                                // validate alltime
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nTotal);
                                // validate month, which shouldn't exist.
                                should.not.exist(hStat.new_users.month);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
            ,userByHour:function(done){
                var dStart = moment.utc().subtract(nTestSize,'hours').startOf('hour');
                var dEnd = dStart.clone();
                var nTotal = 0;
                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var q = [];
                        for (var n = 0; n < nTestSize; n++) {
                            var client = 'clientB';
                            if (n%2) {
                                client = 'clientA';
                                nTotal++;
                            }
                            q.push({
                                name:dNow.getTime()
                                ,email:'testfollower'+n+'@test.com'
                                ,created:dEnd.valueOf()
                                ,client:client
                            });
                            if (n < nTestSize) dEnd.add(1,'hour');
                        }
                        dEnd.subtract(1,'minute');

                        async.forEachOf(q,function(hData,ind,cb) {
                            var user = Base.lookup({sClass:'User',hData:hData});
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process({sFilter:'clientA',dStart:dStart,dEnd:dEnd,sGrain:'hour'},callback);
                    }
                    ,function(callback) {
                        Metric.process({sFilter:'clientB',dStart:dStart,dEnd:dEnd,sGrain:'hour'},callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',sFilter:'clientA',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,hour:true}}})
                            .then(function(oStat){
                                // validate alltime
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nTotal);
                                should.exist(oStat.new_users.hour);
                                should.exist(oStat.new_users.hour.nTotal);
                                oStat.new_users.hour.nTotal.should.equal(nTotal);
                                var n = 0;
                                while (oStat.new_users.hour.next()) {
                                    if (n%2) oStat.new_users.hour.getItem().get('nCount').should.equal(1);
                                }
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{nMin:dStart.valueOf(),sFilter:'clientA',nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,hour:true}}})
                            .then(function(hStat){
                                // validate alltime
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nTotal);
                                // validate hour stats
                                should.exist(hStat.new_users.hour);
                                should.exist(hStat.new_users.hour.nTotal);
                                should.exist(hStat.new_users.hour.aObjects);
                                hStat.new_users.hour.nTotal.should.equal(nTotal);
                                var n = 0;
                                hStat.new_users.hour.aObjects.forEach(function(item) {
                                    if (n%2) item.nCount.should.equal(1);
                                });
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
            ,userAllGrains:function(done){
                this.timeout(30000);

                var dStart = moment.utc().subtract(1,'months').startOf('months');
                var dEnd = moment.utc().startOf('day');
                var nTotal = 0;
                var nFiltered = 0;

                async.series([
                    // Create the user accounts with which we'll make hits.
                    function(callback) {
                        var dDate = dStart.clone();
                        var q = [];
                        while (dDate <= dEnd) {
                            var client = 'clientC';
                            if (!(nTotal % 3)) {
                                client = 'clientA';
                                nFiltered++;
                            } else if (!(nTotal %2)) {
                                client = 'clientB';
                                nFiltered++;
                            }
                            q.push({
                                name:dNow.getTime()
                                ,email:'testfollower'+nTotal+'@test.com'
                                ,created:dDate.valueOf()
                                ,client:client
                            });
                            dDate.add(1,'hour');
                            nTotal++;
                        }
                        //dEnd.subtract(1,'minute');

                        async.forEachOfLimit(q,100,function(hData,ind,cb) {
                            var user = Base.lookup({sClass:'User',hData:hData});
                            user.save(cb);
                        },callback);
                    }
                    // Process the stats.
                    ,function(callback) {
                        Metric.process({sFilter:'clientA,clientB',dStart:dStart,dEnd:dEnd},callback);
                    }
                    // Look up the stats.
                    ,function(callback) {
                        Metric.lookupP({sClass:'User',sFilter:'clientA,clientB',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,hour:true}}})
                            .then(function(oStat){
                                should.exist(oStat);
                                should.exist(oStat.new_users);
                                should.exist(oStat.new_users.alltime);
                                should.exist(oStat.new_users.alltime.get('nCount'));
                                oStat.new_users.alltime.get('nCount').should.equal(nFiltered);
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                    // Lookup again using API
                    ,function(callback) {
                        Base.requestP('get','http://localhost:'+nPort+'/metric/user',{sFilter:'clientA,clientB',nMin:dStart.valueOf(),nMax:dEnd.valueOf(),hMetrics:{new_users:{alltime:true,hour:true}}})
                            .then(function(hStat){
                                // validate alltime
                                should.exist(hStat);
                                should.exist(hStat.new_users);
                                should.exist(hStat.new_users.alltime);
                                should.exist(hStat.new_users.alltime.nCount);
                                hStat.new_users.alltime.nCount.should.equal(nFiltered);

                                // validate hour stats
                                should.exist(hStat.new_users.hour);
                                should.exist(hStat.new_users.hour.nTotal);
                                should.exist(hStat.new_users.hour.aObjects);
                                hStat.new_users.hour.nTotal.should.equal(nFiltered);

                                hStat.new_users.hour.aObjects.forEach(function(item) {
                                    if ((nTotal % 3)==0 || (nTotal % 2)==0)  item.nCount.should.equal(1);
                                });
                            })
                            .then(null,function(err){throw err})
                            .done(callback);
                    }
                ],done);
            }
        }
    }
};