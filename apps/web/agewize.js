var express     = require('express'),
    async       = require('async'),
    RStore      = require('connect-redis')(express),
    App         = require(process.env.NORDIS_ENV_ROOT_NODE_DIR+'/lib/Core/AppConfig'),
    Base        = require(process.env.NORDIS_ENV_ROOT_NODE_DIR+'/lib/Core/Base'),
    Collection  = require(process.env.NORDIS_ENV_ROOT_NODE_DIR+'/lib/Core/Collection'),
    Template    = require(process.env.NORDIS_ENV_ROOT_NODE_DIR+'/lib/Utils/Template'),
    Middleware  = require(process.env.NORDIS_ENV_ROOT_NODE_DIR+'/lib/Utils/Middleware');

process.env.sApp = 'agewize';

var exp_app = express();
exp_app.listen(App.hAppSettings[process.env.sApp].nPort);

// Some shared variables.
var sSessionKey = process.env.sApp+'.sid'; // What we call the express session key. Can be whatever we want.
var sSessionSecret = '1234abcd';
var oCookieParser; // Single instance of espress cookie parser, for use by both socket.io and express itself.
var oSessionStore = new RStore({
    host:App.hOptions.Redis.sWriteServer,
    port:App.hOptions.Redis.nWritePort,
    ttl:App.hAppSettings[process.env.sApp].nSessionLength
}); // Single instance of express session storage, for use by both socket.io and express.

/**
 * Set up ExpressJS, the web server framework we use.
 */
var configureExpress = function(){
    exp_app
//        .use(express.bodyParser())
        .use(oCookieParser)
        .use(express.session({
            store: oSessionStore,
            secret: sSessionSecret,
            key: sSessionKey,
            maxAge  : new Date(Date.now() + (App.hAppSettings[process.env.sApp].nSessionLength * 1000)),
            expires : new Date(Date.now() + (App.hAppSettings[process.env.sApp].nSessionLength * 1000)),
            cookie:{httpOnly:true}
        }))
        .set('view engine','html')
        .engine('html', Template.compile)
        .set('views',process.env.sViewPath)
        .use(function(req,res,next){
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
        App.init({sViewPath:process.env.NORDIS_ENV_ROOT_NODE_DIR+'/templates/agewize/views'},callback);
    }
],function(err,aResult){
    if (err)
        App.fatal(err);
    else {
        oCookieParser = express.cookieParser(sSessionSecret);
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