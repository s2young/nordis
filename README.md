nordis
=====

Node.js framework for rapid web application and API development that utilizes the speed of Redis without sacrificing the piece
of mind provided by a relational database.

Objectives:
-------------

### 1. Code-first.
Define your model in the configuration file and then go to work. Nordis will save data to Redis, as well as create tables and columns in MySql for you. Here is a snippet of the included, example configuration file that defines a 'User' and 'Follow' class:

```Javascript
    User:{
        nClass:1 // Each class is assigned a number for namespacing in redis.
        hProperties:{ // Properties can be mapped to existing tables and columns, but this assumes a clean slate
            id:{sType:'Number',bUnique:true,sSample:'1'}
            ,sid:{sType:'String',bUnique:true,nLength:36,sSample:'Yf8uIoP'}
            ,name:{sType:'String',sSample:'Joe User'}
            ,password:{sType:'String',bPrivate:true,sSample:'password'}
            ,email:{sType:'String',bUnique:true,sSample:'joe@gmail.com'}
            ,referrer_id:{sType:'Number',sSample:null}
        }
        // This is where you define related objects and collections.
        ,hExtras:{
            follows:{
                sType:'Collection'
                ,sClass:'Follow'
                ,sOrderBy:'rank' // rank is a property on the Follow class, by which we sort the user.follows collection.
                ,fnQuery:function(oSelf){
                    // If we need to pull the collection from MySql, this returns the query bits needed to do so.
                    return {followed_id:oSelf.getKey()}
                }
            }
        }
    }
    ,Follow:{
            hProperties:{
                id:{sType:'Number',bUnique:true,sSample:'3'}
                ,followed_id:{sType:'Number',sSample:'1'}
                ,follower_id:{sType:'Number',sSample:'2'                }
                ,rank:{sType:'Number',sSample:'0'}
            }
            ,nClass:2
            ,hExtras:{
                followed_user:{
                    sType:'Object'
                    ,sClass:'User'
                    ,aKey:['followed_id','id']
                    ,fnQuery:function(oSelf){
                        return {id:oSelf.get('followed_id')}
                    }
                }
                ,follower_user:{
                    sType:'Object'
                    ,sClass:'User'
                    ,aKey:['follower_id','id']
                    ,fnQuery:function(oSelf){
                        return {id:oSelf.get('follower_id')}
                    }
                }
            }
        }
```

### 2. Redis + MySql as DB
Nordis stores objects in both Redis and MySql and will always pull from Redis first if the object is available, unless you specify otherwise in your code. This means consistently fast look-ups without losing the peace-of-mind that a relational db provides.  Plugins for Postgres and other relational dbs shouldn't be too hard to add over time.

### 3. Base Class
The Nordis base class provides all your CRUD boilerplate methods. You can create your own custom modules that extend the Base class. 

```Javascript
    var Base = require('nordis').Base;
    
    // CREATE NEW USER
    var user = Base.lookup({sClass:'User'}); // New instance of User class.
    
    // Set some properties and save.
    user.set('name','Joe User');
    user.set('email','joe@gmail.com');
    user.save(function(err){
        console.log(user);// Now you've saved your user.
    });
    
    // LOOKUP EXISTING USER (wih id of 1234)
    Base.lookup({sClass:'User',hQuery:{id:1234}},function(err,user){
        console.log(user); // Now you've got your user.
    });
    
    // LOOKUP VIA SECONDARY KEY
    // In the provided example, the User class includes an email property that is marked as unique.
    // Doing so gives you the ability to do Redis lookups as if email was the primary key:
    Base.looup({sClass:'User',hQuery:{email:'joe@gmail.com'}},function(err,user){
        console.log(user); // Now you've got your user.
    });
    
    // I personally use the secondary key to create unique, obfuscated string ids (guids) for objects
    // so I don't have to use numeric ids in my RESTful calls.
```


### 4. Collection Class
The Nordis collection provides support for getting paged data easily, as well as getting the total number of items in the collection regardless of the size of the page you request. Collections are defined in configuration, including how they are sorted and the query parameters required to pull the collection directly from MySql. They are stored in Redis using Redis' Sorted Set data type, a powerful and fast tool for storing collections. Again, if the data isn't in Redis we'll check MySql.

### 5. Nested Property Lookups
Almost never does a resource exist in a model without relationships with other resources. Twitter users, for example, have followers. Nordis allows you to retrieve a complex document relating to the resource including collections of data (a list of follows, for example; or just the first page of follows).

Node.js example:
```Javascript
    var Base = require('nordis').Base;
    
    // LOOKUP ALL FOLLOWS
    Base.lookup({
        sClass:'User',
        hQuery:{
            id:1234
        },
        hExtras:{
            follows:true
        }
    },function(err,user){
        // You now have retrieved the User with id==1234, along with ALL his follows.
        console.log('USER HAS '+user.follows.nTotal+' followers!');
    });
    
    // ALL FOLLOWS + follower_user property.
    // You can go as deeply into the document as you like. A Follow item only gives me the ids of the
    // follower and followed.  I want the name/email of the follower_user (see example config for model details):
    Base.lookup({
        sClass:'User',
        hQuery:{
            id:1234
        },
        hExtras:{
            follows:{
                hExtras:{
                    follower_user:true
                }
            }
        }
    },function(err,user){
        // You now have retrieved the User with id==1234, along with ALL his follows.
        console.log('USER HAS '+user.follows.nTotal+' followers!');
        console.log('THE FIRST FOLLOWER NAME IS: '+user.follows.first().follower_user.get('name'));
    });
    
```

REST example:
```Javascript
    var request = require('request');

    // Retrieve user and his follows using nordis API boilerplate middleware.
    request.get({uri:'http://yourapi/user/1234?hExtras[follows]=true'},function(error, response, body){
        var user = JSON.parse(body);
        console.log('USER HAS '+user.follows.nTotal+' followers!');
    });
    
    // In provided sample conf.js, we also define a specific endpoint for getting user follows: 
    request.get({uri:'http://yourapi/user/1234/follows'},function(error, response, body){
        // In this case, we don't get the user on the document, only the collection of follows.
        var follows = JSON.parse(body);
        console.log('USER HAS '+follows.nTotal+' followers!');
    });
```

### 6. API Boilerplate & Apiary Docs 
Nordis is packaged with the ability to create a RESTful API by defining endpoints in your config file and utilizing the provided expressjs Middleware functions. The parser middleware performs all the CRUD exposed in the API, while the pre-parser only looks up the desired resource and sets properties on the resource (in the case of updates) but does NOT
save the resource. There are a couple of hooks you can add to any api call to customize the output, track stats, check security, etc. You can, of course, bypass this middleware completely and build your own API. By defining the API in config, however, you can leverage the packaged apiary.js script which outputs API documentation for use over at apiary.io. Your choice.

Check out the documentation created from the sample configuration provided in this project: http://docs.nordis.apiary.io/





