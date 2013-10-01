var express     = require('express'),
    async       = require('async'),
    fs          = require('fs'),
    RStore      = require('connect-redis')(express),
    App         = require(process.env.GOBA_ENV_ROOT_NODE_DIR+'/lib/Core/AppConfig'),
    Base        = require(process.env.GOBA_ENV_ROOT_NODE_DIR+'/lib/Core/Base'),
    Collection  = require(process.env.GOBA_ENV_ROOT_NODE_DIR+'/lib/Core/Collection'),
    User        = require(process.env.GOBA_ENV_ROOT_NODE_DIR+'/lib/Model/User'),
    Platform    = require(process.env.GOBA_ENV_ROOT_NODE_DIR+'/lib/Model/User/Platform'),
    Template    = require(process.env.GOBA_ENV_ROOT_NODE_DIR+'/lib/Utils/Template'),
    Middleware  = require(process.env.GOBA_ENV_ROOT_NODE_DIR+'/lib/Utils/Middleware');

process.env.sApp = 'agewize';

var exp_app = express(); //Express application, which is used by the server.
var server = exp_app.listen(App.hAppSettings[process.env.sApp].nPort); // Express-based web application server instance.

// Some shared variables.
var sSessionKey = 'engagemgr.sid'; // What we call the express session key. Can be whatever we want.
var oCookieParser; // Single instance of espress cookie parser, for use by both socket.io and express itself.
var oSessionStore = new RStore({
    host:App.hOptions.Redis.sWriteServer,
    port:App.hOptions.Redis.nWritePort,
    db:App.hOptions.Redis.nDb,
    ttl:App.hAppSettings[process.env.sApp].nSessionLength
}); // Single instance of express session storage, for use by both socket.io and express.

/**
 * Set up ExpressJS, the web server framework we use.
 */
var configureExpress = function(){
    exp_app
        .use('/shared',express.static(process.env.GOBA_ENV_ROOT_NODE_DIR+'/templates/shared'))
        .use(express.favicon(process.env.GOBA_ENV_ROOT_NODE_DIR+'/templates/shared/favicon.png'))
        .use(express.bodyParser())
        .use(oCookieParser)
        .use(express.session({
            store: oSessionStore,
            secret: App.getConsumer().get('sSecret'),
            key: sSessionKey,
            maxAge  : new Date(Date.now() + (App.hAppSettings[process.env.sApp].nSessionLength * 1000)),
            expires : new Date(Date.now() + (App.hAppSettings[process.env.sApp].nSessionLength * 1000)),
            cookie:{httpOnly:false}
        }))
        .set('view engine','dot')
        .engine('dot', Template.compile)
        .set('views',process.env.sViewPath)
        .use(Middleware.parseSession)
        .use(function(req,res,next){
            req.hData.Stripe = App.hOptions.Stripe;
            next();
        });
};
/**
 * This function defines all route paths supported in the app.
 */
var configureRoutes = function(){
    exp_app.get('/', function (req, res) {
        render(req,res,null,'index');
    });

    exp_app.get('/signup/:sPath', function (req, res) {
        req.hData.sPath = (req.params.sPath) ? req.params.sPath.toLowerCase() : '';

        if (req.headers.https != 'on' && process.env.GOBA_ENV != 'local') {
            console.log('https://'+req.host+req.path);
            res.redirect(302,'https://'+req.host+req.path);
        } else {
            var oApiConsumer = App.getConsumer(req.hData.sPath);
            if (oApiConsumer)
                async.parallel([
                    function(callback){
                        // Find payment plans by starting at the current level and moving up.
                        (function findPaymentPlans(oConsumer){
                            oConsumer.loadExtras({cActivePlans:true},function(err){
                                if (!oConsumer.cActivePlans.nTotal && oConsumer.get('nParentID'))
                                    findPaymentPlans(App.getConsumer(oConsumer.get('nParentID')));
                                else {
                                    req.hData.cPlans = oConsumer.cActivePlans;
                                    callback();
                                }
                            });
                        })(oApiConsumer);
                    }
                    ,function(callback){
                        if (req.session.sToken)
                            Base.lookup({sClass:'Platform',hQuery:{sToken:req.session.sToken},hExtras:{oUser:true}},callback);
                        else
                            callback();
                    }
                ],function(err,aResults){
                    req.hData.oConsumer = oApiConsumer;

                    if (aResults[1] && aResults[1].get('nApiConsumerID') == oApiConsumer.get('nID')) {
                        req.hData.oPlatform = aResults[1];
                        req.hData.oUser = aResults[1].oUser;
                    }
                    render(req,res,err,'signup');
                });

            else
                render(req,res,null,'signup');
        }
    });

    exp_app.all('/checkout/:sPath/:sPlanID', function (req, res) {
        // Do permanent, https redirect if this page is accessed in a non-secure way on production.
        if (req.headers.https != 'on' && process.env.GOBA_ENV != 'local') {
            res.redirect(302,'https://'+req.host+req.path);
        } else {
            // Prefill the checkout form on dev.
            req.hData.nNumber = (process.env.GOBA_ENV == 'prod') ? '' : '4242 4242 4242 4242';
            req.hData.nCVC = (process.env.GOBA_ENV == 'prod') ? '' : '123';
            req.hData.nMonth = (process.env.GOBA_ENV == 'prod') ? '' : '12';
            req.hData.nYear = (process.env.GOBA_ENV == 'prod') ? '' : (new Date().getFullYear() + 1);

            req.hData.sPath = (req.params.sPath) ? req.params.sPath.toLowerCase() : '';

            var oApiConsumer = App.getConsumer(req.hData.sPath);
            if (oApiConsumer)
                // Look up the user.
                async.parallel([
                    function(callback) {
                        Base.lookup({sClass:'Platform',hQuery:{sToken:req.session.sToken},hExtras:{oUser:true}},callback);
                    }
                    ,function(callback) {
                        Base.lookup({sClass:'PaymentPlan',hQuery:{sID:req.params.sPlanID}},callback);
                    }
                ],function(err,aResults){
                    if (req.method.toLowerCase() == 'get') {
                        if (err)
                            render(req,res,err,'checkout');
                        else if (!aResults[0] || !aResults[0].get('nID'))
                            res.redirect(302,'/signup');
                        else if (!aResults[1] || !aResults[1].get('nID'))
                            render(req,res,'Plan not found.','checkout');
                        else
                            render(req,res,null,'checkout');
                    } else {

                        req.hData.address_line1 = req.body.address_line1;
                        req.hData.address_line2 = req.body.address_line2;
                        req.hData.address_city = req.body.address_city;
                        req.hData.address_state = req.body.address_state;
                        req.hData.address_zip = req.body.address_zip;

                        // This is where we transact with Stripe.
                        console.log('ATTEMPTING CHARGE');
                        aResults[1].chargeCard({
                            oPlatform:aResults[0],
                            sToken:req.body.stripeToken,
                            sTitle:req.session.sTitle,
                            nStart:req.session.nStart
                        },function(err,oCustomer){
                            if (err) {
                                App.error(err);
                                render(req,res,err,'checkout');
                            } else {
                                res.redirect('/receipt/'+req.params.sPath+'/'+req.params.sPlanID+'/'+oCustomer.get('sID'));
                            }
                        });
                    }
                });
            else
                render(req,res,null,'checkout');
        }
    });

    exp_app.get('/receipt/:sPath/:sPlanID/:sCustomerID',function(req,res){
        var oApiConsumer = App.getConsumer(req.hData.sPath);
        if (oApiConsumer)
            async.parallel([
                function(callback) {
                    Base.lookup({sClass:'Platform',hQuery:{sToken:req.session.sToken},hExtras:{oUser:true}},callback);
                }
                ,function(callback) {
                    Base.lookup({sClass:'PaymentPlan',hQuery:{sID:req.params.sPlanID}},callback);
                }
                ,function(callback) {
                    Base.lookup({sClass:'Customer',hQuery:{sID:req.params.sCustomerID}},callback);
                }
            ],function(err,aResults){
                req.hData.oUser = aResults[0].oUser;
                req.hData.oPlan = aResults[1];
                req.hData.oCustomer = aResults[2];
                req.hData.oNewConsumer = App.getConsumer(req.hData.oCustomer.get('nObjectID'));

                req.hData.oCustomer.getInvoices(function(err,hInvoices){
                    req.hData.hInvoices = hInvoices;
                    render(req,res,null,'receipt');
                });
            });
        else
            render(req,res,'Reciept not found.','receipt');
    });

    exp_app.post('/v1/:sRoute/:sPath',function(req,res){
        // Under which consumer will this order be placed? The sPath should correspond to
        // the sShortName of the parent consumer.
        var oApiConsumer = req.hData.oApiConsumer;
        if (req.params.sPath && App.getConsumer(req.params.sPath))
            oApiConsumer = App.getConsumer(req.params.sPath);

        async.series([
            function(callback){
                if (req.params.sRoute == 'register' && req.params.sPath && process.env.GOBA_ENV == 'prod')
                    // Confirm email address as valid.
                    switch (req.params.sPath) {
                        case 'cru':
                            if (!req.body.sEmail.toLowerCase().match(/(cru\.org|ucsm\.org)/))
                                callback('E-mail must be a valid cru.org address.');
                            else
                                callback();
                            break;
                        default:
                            callback();
                            break;
                    }
                else
                    callback();
            }
            ,function(callback) {
                switch (req.params.sRoute) {
                    case 'interest':
                        var Email = require(process.env.GOBA_ENV_ROOT_NODE_DIR+'/lib/Utils/MsgMedia/Email');
                        Email.send({
                            sFrom:req.body.sEmail,
                            sTo:'stuart@gobaengage.com',
                            sSubject:'Goba Engage Interest Form',
                            sBody:'Name: '+req.body.sName+'\n Email: '+req.body.sEmail+'\n\nDetails:'+req.body.sDetails
                        },function(err,hResult){
                            if (err) {
                                App.error(err);
                                callback(err);
                            } else
                                callback();
                        });
                        break;
                    case 'register':
                        Base.callAPI({
                            method:'POST',
                            host:oApiConsumer.get('sApiDomain'),
                            path:'/v1/user/register.json',
                            hData:{
                                sToken:oApiConsumer.get('sToken'),
                                sEmail:req.body.sEmail,
                                sName:req.body.sName,
                                nPIN:req.body.nPIN
                            }
                        },function(err,hResult){
                            if (hResult.aExceptions)
                                callback(hResult.aExceptions[0]);
                            else if (hResult.sToken) {
                                req.session.sToken = hResult.sToken;
                                req.session.save();
                                callback(null,{nUserID:hResult.nUserID,sEmail:hResult.sEmail,sName:hResult.sName,bPassed:(req.body.nPIN!=undefined),bPassword:false});
                            } else
                                callback();
                        });
                        break;
                    case 'save':
                        Base.lookup({sClass:'Platform',hQuery:{sToken:req.session.sToken},hExtras:{oUser:true}},function(err,oPlatform){
                            if (err)
                                callback(err);
                            else if (!oPlatform.get('nID'))
                                callback('Password update failed. Please start over.');
                            else {
                                var crypto = require('crypto');
                                var sSql = 'UPDATE PlatformTbl SET sPassword=? WHERE nApiConsumerID=? AND sToken=?';
                                App.MySql.execute({},sSql,[crypto.createHash('sha224').update(req.body.sPassword).digest("hex"),oApiConsumer.get('nID'),req.session.sToken],function(err,res){
                                    if (err)
                                        callback(err);
                                    else {
                                        console.log(res);
                                        callback(null,{nUserID:oPlatform.oUser.get('nID'),sEmail:req.body.sEmail,sName:oPlatform.oUser.get('sName'),bPassed:true,bPassword:true});
                                    }
                                });
                            }
                        });
                        break;
                    case 'consumer':

                        // We have to save the chosen consumer title and start timestamp to the session
                        // because the client-side cookies we're using to maintain state on the /signup
                        // page are limited to the /signup path. This is an angularjs limitation.
                        req.session.sTitle = req.body.sTitle;
                        req.session.nStart = req.body.nStart;
                        req.session.save();

                        var hResult = req.body;
                        hResult.bChapter = true;

                        callback(null,hResult);

                        break;
                    default:
                        callback();
                        break;
                }
            }
        ],function(err,aResult){
            if (err)
                res.end('{"hException":'+JSON.stringify(err)+'}');
            else if (aResult[1])
                res.end(JSON.stringify(aResult[1]));
            else
                res.end('{}');
        });
    });

    exp_app.get('/signout/:sPath',function(req,res){
        req.session.destroy();
        res.redirect('/signup/'+req.params.sPath);
    });

    exp_app.get('/signout/',function(req,res){
        req.session.destroy();
        res.redirect('/');
    });

    exp_app.all('/*', function (req, res) {
        var sShortName = req.path.substring(1);
        if (sShortName && App.getConsumer(sShortName.toLowerCase()) && fs.existsSync(process.env.sViewPath+'/'+sShortName.toLowerCase()+'.dot'))
            render(req,res,null,sShortName.toLowerCase());
        else
            render(req,res,null,'index');
    });
};

/**
 * This starts the app up by passing the default View Path to AppConfig and letting
 * AppConfig do the rest, including loading of the default API Consumer. It also loads three
 * Redis db connections for use by Socket.io.
 */
async.parallel([
    function(callback){
        App.Redis.acquire(callback);
    },
    function(callback){
        App.Redis.acquire(callback);
    },
    function(callback){
        App.Redis.acquire(callback);
    },
    function(callback){
        App.init({sViewPath:__dirname+'/views'},callback);
    }
],function(err,aResult){
    if (err)
        App.fatal(err);
    else {
        oCookieParser = express.cookieParser(App.getConsumer().get('sSecret'));
        configureExpress();
        configureRoutes();
    }
});

/**
 * The render method actually outputs the content to the page. It also handles display of
 * errors and redirects upon successful signin.
 * @param req
 * @param res
 * @param err
 * @param sPath
 */
function render(req,res,err,sPath) {
    // Handle redirection to intended destination once signed-in.
    if (err) {
        if (err.toString() == '[object Object]')
            req.hData.sException = JSON.stringify(err);
        else
            req.hData.sException = err.toString();
    } else {

        if (sPath == 'signin' && req && req.route && req.route.path != '/signin' && req.route.path != '/' && req.route.path.indexOf(':') == -1 && req.session)
            req.session.redirectTo = req.route.path;
        else if (req.session && req.session.sToken && req.session.redirectTo) {
            var sRedirect = req.session.redirectTo;
            req.session.redirectTo = undefined;
            App.info('redirect to'+sRedirect);
            res.redirect(sRedirect);
            return;
        }
    }

    res.render(sPath,req.hData,function(err2,html){
        if (err2) {
            App.info('TEMPLATE ERROR');
            App.error(err2);
            req.hData.sException = err2;
            if (sPath != 'error')
                render(req,res,null,'error');
            else
                res.end('Oopsie! Something went really wrong.');
        } else
            res.end(html);
    });
}