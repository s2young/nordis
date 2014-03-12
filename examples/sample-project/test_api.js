var Base        = require('nordis').Base,
    express     = require('express'),
    request     = require('request'),
    Middleware  = require('nordis').Middleware,
    App         = require('nordis').AppConfig;


// Initialize your app. You may either set your environment variables or pass them into the init method.
App.init({
    NORDIS_ENV_ROOT_DIR:__dirname // This is a one-directory project so we're already in the root.
    ,NORDIS_ENV_CONF:__dirname+'/conf.js' // The conf.js
    ,NORDIS_ENV:'local' // I use local, dev and prod here, but it is used in overriding settings in conf.js.
},function(err){

    if (err)
        App.error(err);
    else {
        // This should fire up a web server (at http://localhost:2000/) and will support basic GET, POST, and DELETE calls.
        // This has NO security to it.  Just boilerplate API connected to your model.
        var exp_app = express();
        server = exp_app.listen(2000);
        exp_app.use(express.bodyParser());
        exp_app.use(Middleware.apiParser);


        // Here's how you might call the above app from a script
        // This is an API request that is equivalent to what we did in test.js.
        request.post('http://localhost:2000/user/new',{form:{name:'Johnny',email:'john@gmail.com'}},function(err,res,body){
            if (err)
                App.error(err);
            else {
                var result = JSON.parse(body);
                App.log('HELLOOOO '+result.name+'!');
                App.exit();
            }
        });
    }

});
