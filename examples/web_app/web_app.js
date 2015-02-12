var express     = require('express'),
    async       = require('async'),
    Template    = require('./../../lib/Utils/Template'),// In your app, this needs to be require('nordis').Template - or use your own templating engine of course.
    AppConfig   = require('./../../lib/AppConfig'),// In your app, this needs to be require('nordis').AppConfig
    Base        = require('./../../lib/Base'),// In your app, this needs to be require('nordis').Base
    Metric      = require('./../../lib/Metric'),// In your app, this needs to be require('nordis').Metric
    Collection  = require('./../../lib/Collection'),// In your app, this needs to be require('nordis').Collection
    NordisMiddleware  = require('./../../lib/Utils/Middleware');// In your app, this needs to be require('nordis').Middleware

process.env.sApp = 'nordis_sample_web_app';

var exp_app = express();
exp_app.listen(2003);

/**
 * The render method actually outputs the content to the page. It also handles display of errors.
 * @param req
 * @param res
 * @param err
 * @param sPath
 */
function render(req,res,err,sPath) {
    // Handle redirection to intended destination once signed-in.
    if (err) {
        if (err instanceof Object)
            req.hData.sException = JSON.stringify(err);
        else
            req.hData.sException = err.toString();

        AppConfig.error(err);
    }

    res.render(sPath,req.hData,function(err2,html){
        if (err2) {
            req.hData.exception = err2;
            if (sPath != 'error')
                render(req,res,null,'error');
            else {
                AppConfig.error(err2);
                res.end('Oopsie! Something went really wrong.');
            }
        } else {
            AppConfig.debug('sPath: '+sPath);
            res.end(html);
        }
    });
}

/**
 * ExpressJS is the actual web server software that powers the site.
 * This example is seriously bare-bones, lacking session management, body parsing, and other
 * out-of-the-box middleware you'll likely use in a real-world app.  The focus here is to show
 * how the Nordis middleware plugs in and what it does.
 */
var configureExpress = function(){
    exp_app
        .use('/assets',express.static(__dirname+'/assets'))// This tells express where to find static assets (js, css, etc).
        .use(express.favicon(__dirname+'/assets/favicon.png'))// I would use nginx to host static images in a real-world app.
        .use(NordisMiddleware.clientHelper)
        .use(express.bodyParser())
        .use(function(req,res,next){
            res.header('Access-Control-Allow-Origin', '*');
            // I'm storing my page 'context' in a hash called 'hData.'  This context will
            // be passed to the template rendering engine for server-side data-binding.
            req.hData = {};
            // Next up in the middleware stack is the Nordis middleware's apiPreparser.
            // This middleware uses the url path to determine if a particular object should
            // be loaded. For example, a path like this, /user/abc123, would be interpreted
            // by the middleware as an instruction to load up a User with the id of abc123.
            next();
        })
        .use(NordisMiddleware.apiPreparser)
        .use(function(req,res,next){
            // Track page hits and api requests.
            if (!req.hNordis.hEndpoint) {
                Metric.track({sStat:'hits',Params:req.hNordis.sPath},next);
            } else if (req.hNordis.hEndpoint)
                Metric.track({sStat:'api_requests',Params:req.hNordis.sPath},next);
            else
                next();
        })
        .set('view engine','html')
        .engine('html', Template.compile)
        .set('views',process.env.sViewPath);
};
/**
 * This function defines all route paths supported in the app.
 */
var configureRoutes = function(){
    /**
     * Here's your homepage.
     */
    exp_app.get('/', function (req, res) {
        render(req,res,null,'index');
    });
    /**
     * Metric display page.
     */
    exp_app.get('/stats', function (req, res) {
        render(req,res,null,'stats');
    });

    exp_app.get('/api', function (req, res) {
        render(req,res,null,'api');
    });
    /**
     * Page for building a config file from scratch.
     */
    exp_app.get('/configurator',function(req,res){
        render(req,res,null,'configurator');
    });
    /**
     * And a user's detail page.
     */
    exp_app.get('/user/:user_sid', function (req, res) {
        // Nordis sticks the context object into req.hNordis.oResult. I like to put it in a context-sensible place.
        req.hData.user = req.hNordis.oResult;
        render(req,res,null,'user');
    });
    /**
     * For all other api calls, you can have a catch-all path that hands JSON response back to the client. The nordis middleware sets a variable on the request that can be serialized. It is located at req.hNordis.hResult.
     */
    exp_app.all('/*', function (req, res) {
        // If any errors occur in the middleware, it will be found in req.hNordis.sException
        if (req.hNordis.sException) {
            AppConfig.error(req.hNordis.sException);
            res.status(500);
            if (req.hNordis.sException instanceof Object)
                res.end(JSON.stringify(req.hNordis.sException));
            else
                res.end(req.hNordis.sException);
        } else
            res.end(JSON.stringify(req.hNordis.hResult));


    });
};
/**
 * This starts the app up by passing the default View Path to AppConfig and letting
 * AppConfig do it's standard initialization.
 */
AppConfig.init({
    sViewPath:__dirname+'/views'
},function(err){
    if (err)
        AppConfig.fatal(err);
    else {
        Template.defs.hClasses = AppConfig.getClasses();
        configureExpress();
        configureRoutes();
    }
});