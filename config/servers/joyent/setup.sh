    #!/usr/bin/env bash

    ## Web Server installation script. First, copy this script into your root dir and execute.

    # 1. Run ssh keygen while signed in as root. ssh-keygen -t rsa -C "your_email@example.com".
    #       Apply passphrase (I use same password as joyent acct).
    #       Save as id_rsa.
    # 2. chmod 700 the .ssh directory
    # 3. chmod 600 the id_rsa.pub file
    # 4. cat id_rsa.pub and copy the contents over to github.
    # 5. . setup.sh

    echo "------------------------------------------------------"
    echo "JOYENT SERVER SET-UP"
    echo


    if [ ! -e "/root/.ssh/id_rsa.pub" ]; then
        EMAIL=""
        read -p "Enter your email:" EMAIL

        cd ~/.ssh
        ssh-keygen -t rsa -C "$EMAIL"
        ssh-add id_rsa
        cat ~/.ssh/id_rsa.pub
        echo "Copy the above lines from 'ssh-rsa' all the way to your email address and copy into Github deploy keys."
    fi

    SERVER="";
    read -p "Please environment type (prod or dev) [dev]:" SERVER
    [  -z "$SERVER" ] && SERVER="dev" || echo $SERVER

    GITHUB="";
    read -p "Should we do a github setup and clone? [y]" GITHUB
    [  -z "$GITHUB" ] && GITHUB="y" || echo $GITHUB
    if [ "$GITHUB" == "y" ]; then
        echo "------------------------------------------------------"
        echo "GitHub Setup & Code Clone"
        echo


        pkgin install scmgit
        pkgin install gcc47
        pkgin install gmake-3

        cd /home
        mkdir prod
        rm -R prod/nordis
        cd prod

        git clone git@github.com:s2young/nordis.git

        cd /home/prod/nordis

        echo "------------------------------------------------------"
        echo "Node.js Package Install"
        echo

        npm install node-gyp -g
        npm install


        while true; do
            NPM="";
            read -p "Hit [Enter] to run npm install or 0 when done:" NPM
                case "$NPM" in
                    0)
                        break
                    ;;
                    *)
                         npm install
                    ;;
                esac
        done
    fi

    # Make the apps executable.
    chmod -R 755 /home/prod/nordis/apps

    NGINX="";
    read -p "Should we install nginx web server [n]:" NGINX

    [  -z "$NGINX" ] && NGINX="n" || echo "skip nginx"

    if [ "$NGINX" == "y" ]; then
        echo "------------------------------------------------------"
        echo "NGiNX Install"
        echo

        VERSION="";

        cd
        read -p "Please enter desired NGINX version number to install [1.4.2]:" VERSION

        [  -z "$VERSION" ] && VERSION="1.4.2" || echo $VERSION

        echo "Download nginx v$VERSION"

        URL=http://nginx.org/download/nginx-$VERSION.tar.gz

        echo $URL

        wget -q "$URL"
        tar -xzvf nginx-$VERSION.tar.gz
        cd nginx-$VERSION
        ./configure --with-http_ssl_module
        make
        make install

        svccfg import /home/prod/nordis/config/servers/joyent/$SERVER/nginx.xml
        svcadm enable nginx

        curl -sL -w "%{http_code}\\n" "http://localhost:80/" -o /dev/null

        echo $http_code

        if [ !$http_code == 200 ]; then
            LOG=$(svcs -L nginx)
            echo "Something went wrong with nginx. Check the log file here: $LOG"
        fi
    fi

    REDIS="";
    read -p "Should we install redis server [n]:" REDIS

    [  -z "$REDIS" ] && REDIS="n" || echo

    if [ "$REDIS" == "y" ]; then
        echo "------------------------------------------------------"
        echo "Redis Install"
        pkgin install redis
        svcadm enable redis
    fi

    SERVICE="";

    while true; do
        read -p "Enter node.js app/service to install or 0 to quit:" SERVICE
        case "$SERVICE" in
            0)
                break
            ;;
            *)
                svcadm disable $SERVICE
                svccfg delete $SERVICE
                svccfg import /home/prod/nordis/config/servers/joyent/$SERVER/$SERVICE.xml
                svcadm enable $SERVICE
            ;;
        esac
    done

    # Because servers aren't always talking on the same vlan, Joyent gave me this command to make sure instances can talk to one another:
    # route -p add -interface 10.0.0.0 -gateway `ifconfig net1 | grep inet | awk '{print $2}'`


    echo "------------------------------------------------------"
    echo "Bash Shell Config"
    echo "Add the following environment variables to your interactive shell (~/.bash_profile):"
    echo "export NORDIS_ENV='local|dev|prod'"
    echo "export NORDIS_ENV_CONF='/home/prod/nordis/config/servers/joyent/ENV/conf.js'"
    echo "export NORDIS_ENV_ROOT_DIR='/home/prod/nordis'"
    echo "export NORDIS_ENV_ROOT_NODE_DIR='/home/prod/nordis'"
