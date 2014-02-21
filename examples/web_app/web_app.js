var express     = require('express'),
    doT         = require('dot'),
    async       = require('async'),
    AppConfig   = require('./../../lib/AppConfig'),// In your app, this needs to be require('nordis').AppConfig
    Base        = require('./../../lib/Base'),// In your app, this needs to be require('nordis').Base
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
};
/**
 * The Template variable will house our Express-compatible 'compile' function for rendering template contents.
 * Use whatever template engine. I use 'doT' because it's fast and I don't need it to do much.
 */
var Template;
/**
 * This function prepares doT (template engine).
 */
var configureDOT = function(){
    var fs = require('fs');

    Template = {hTemplates:{}};
    // If you are a doT user, you may notice that this example uses double-braces instead of doT's
    // default double-curly-braces for data-binding. This is because many client-side templating engines,
    // including Angular.js (my personal preference) use double-curly-braces. Changing the default prevents confusion & error.
    doT.templateSettings = {
        evaluate:    /\[\[([\s\S]+?)\]\]/g,
        interpolate: /\[\[=([\s\S]+?)\]\]/g,
        encode:      /\[\[!([\s\S]+?)\]\]/g,
        use:         /\[\[#([\s\S]+?)\]\]/g,
        define:      /\[\[##\s*([\w\.$]+)\s*(\:|=)([\s\S]+?)#\]\]/g,
        conditional: /\[\[\?(\?)?\s*([\s\S]*?)\s*\]\]/g,
        iterate:     /\[\[~\s*(?:\]\]|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\]\])/g,
        varname: 'hData',
        strip: false,
        append: true,
        selfcontained: false
    };

    doT.defs = {
        loadfile:function(sPath) {
            return fs.readFileSync(process.env.sViewPath+sPath);
        }
        ,hClasses:AppConfig.hClasses
    };

    // This is the function that expressjs uses to render data-bound templates.
    // This function also caches the templates when the environment variable (NORDIS_ENV)
    // isn't set 'local.' That means that template changes will be reflected immediately on a
    // localhost environment but require a restart in a staging or production environment.
    Template.compile = function(sPath,hData,fnCallback){
        async.series([
            function(cb){
                // This code caches templates if not in a local environment.
                // This means the app must be restarted if views change.
                if (Template.hTemplates[sPath] && Template.hTemplates[sPath] instanceof Function && process.env.NORDIS_ENV != 'local')
                    cb();
                else if (!fs.existsSync(sPath))
                    cb('Not found: '+sPath);
                else
                    fs.readFile(sPath,'utf8',function(err,sTemplate){
                        if (!err)
                            Template.hTemplates[sPath] = doT.template(sTemplate,undefined,doT.defs);
                        cb(err);
                    });
            }
        ],function(err){
            if (err)
                fnCallback(err);
            else
                try {
                    hData.hClasses = AppConfig.hClasses;
                    fnCallback(null,Template.hTemplates[sPath](hData));
                } catch (err) {
                    fnCallback('Template error on '+sPath+'; '+err.toString());
                }
        });
    };
};
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
        .use(express.bodyParser())
        .use(function(req,res,next){
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
            // And we're also going to track page stats, but not API calls.  So if the hEndpoint was found in the middleware, skip it.
            // Also, in our example we hacked in our stats endpoints directly as express-handled paths, so we're gonna skip those too.
            if (!req.hNordis.hEndpoint && !req.hNordis.sPath.match(/hits/)) {
               console.log('Tracking: '+req.hNordis.sPath);
                AppConfig.trackStat('hits',[req.hNordis.sPath],next);
            } else
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
     * Stats display page.
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
     * This endpoint allows an api-style request for stats on the /stats page.
     */
    exp_app.get('/hits/:grain',function(req,res){
        var hExtras = {};
        hExtras[req.params.grain] = {nMin:req.query.nMin,nMax:req.query.nMax};
        var oApp = Base.lookup({sClass:'App'});
        oApp.loadExtras({hits:{hExtras:hExtras}},function(err){
            if (err)
                res.end(err.toString());
            else
                res.end(JSON.stringify(oApp.hits[req.params.grain].toHash()));
        });
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
        configureDOT();
        configureExpress();
        configureRoutes();
    }
});