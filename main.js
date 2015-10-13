/*
 ____
|  _ \ __ _ ___ ___ 
| |_) / _` / __/ __|
|  __/ (_| \__ \__ \
|_|   \__,_|___/___/
By: Jason Stallings
URL: http://github.com/octalmage/pass
*/

var gui = require("nw.gui");
var SimplePeer = require("simple-peer");
var os = require("os");
var request = require("request");

var win = gui.Window.get();

var sender = 0;

var pages = ["start", "receive", "send"];

var app, io, hostname, ip, pingTimer, socket, peer;

//Focus the window.
win.show();

win.showDevTools();

$(document).on("ready", function()
{
	$(".startButton").on("click", function()
	{
		type = $(this).attr("data-type");

		if (type === "send")
		{
			sender = 1;
			switchPage("send");
			
		}
		else
		{
			switchPage("receive");
			
			startPinging();
			startSocketServer();
		}
	});
	
	$("#sendButton").on("click", function()
	{	
		sendWindow();
	});
});

/*
 ____               _                
|  _ \ ___  ___ ___(_)_   _____ _ __ 
| |_) / _ \/ __/ _ \ \ \ / / _ \ '__|
|  _ <  __/ (_|  __/ |\ V /  __/ |   
|_| \_\___|\___\___|_| \_/ \___|_|   
									
*/

/**
 * Get the nessesary information and schedule ping to run every minute.
 */
function startPinging()
{
	ip = getIP();
	hostname = os.hostname();
	pingTimer = setInterval(ping, 60000);
	ping();
}

/**
 * Ping the zeroconf server to let it know we're open for receiving windows.
 */
function ping()
{
	var url = "http://zerohero.app.octalmage.com/add/pass/" + hostname + "/" + ip;

	request(url, function(error, response, body)
	{
		if (!error && response.statusCode == 200)
		{
			console.log(body);
		}
	});
}

/**
 * Get local IP.
 * TODO: Make sure this is cross platform.
 * @return {string} IP Address.
 */
function getIP()
{
	var networkInterfaces = os.networkInterfaces();
	var ip = networkInterfaces.en0[1].address;
	return ip;
}

/**
 * Starts a socket.io and web server for incomming connections from the sender.
 * @return {[type]} [description]
 */
function startSocketServer()
{
	app = require("http").createServer(function(req, res) {});
	io = require("socket.io")(app);
	
	app.listen(8890);
	
	io.on('connection', function(rsocket) 
	{
		console.log("Sender connected.");
		
		peer = new SimplePeer();
		
		rsocket.on('signal', function (data) 
		{
    		peer.signal(data);
  		});
		
		peer.on('signal', function(data)
		{
			rsocket.emit("signal", data);
		});
		
		peer.on('stream', function(stream)
		{
			//got remote video stream, now let's show it in a video tag.
			var video = document.querySelector('video');
			video.src = window.URL.createObjectURL(stream);
			video.play();
			video.addEventListener('playing', getVideoSize, false);
			
			function getVideoSize()
			{
				win.width = video.videoWidth;
				win.height = video.videoHeight;

				video.removeEventListener('playing', getVideoSize, false);
			}
			
		});
	});
}

/*
 ____                 _           
/ ___|  ___ _ __   __| | ___ _ __ 
\___ \ / _ \ '_ \ / _` |/ _ \ '__|
 ___) |  __/ | | | (_| |  __/ |   
|____/ \___|_| |_|\__,_|\___|_|   
								 
*/

/**
 * Open a dialog to select a window, and get a stream.
 */
function sendWindow()
{
	gui.Screen.Init();
	gui.Screen.chooseDesktopMedia(["window"], function(streamId)
	{
		var vid_constraint = {
			mandatory:
			{
				chromeMediaSource: 'desktop',
				chromeMediaSourceId: streamId,
				maxWidth: 1920,
				maxHeight: 1080
			},
			optional: []
		};
		navigator.webkitGetUserMedia(
		{
			audio: false,
			video: vid_constraint
		}, sendMedia, function() {});
	});
}

/**
 * Callback for getUserMedia, it routes the stream to the correct receiver.
 * @param  {MediaStream} stream The stream of the selected window.
 */
function sendMedia(stream)
{
	getReceivers(function(ip)
	{
		connectToSocketServer(ip, stream);
	});
}

/**
 * Hits our zeroconf server and returns an IP address.
 * @param  {Function} callback Function to call after request returns.
 * @return {string}            IP of the local server.
 */
function getReceivers(callback)
{
	var url = "http://zerohero.app.octalmage.com/list/pass";

	request(url, function(error, response, body)
	{
		if (!error && response.statusCode == 200)
		{
			var receivers = JSON.parse(body);
			callback(receivers[0].ip);
		}
	});
}

/**
 * Connect to the local receiver, and send it the stream!
 * @param  {string} ip     IP address of the receiver.
 * @param  {MediaStream} stream The stream of the selected window.
 */
function connectToSocketServer(ip, stream)
{
	//Use socket.io for signal data.
	socket = require("socket.io-client")("http://" + ip + ":8890");
	
	socket.on("connect", function()
	{
		//Start our peer to peer connection.
		peer = new SimplePeer(
		{
			initiator: true,
			stream: stream
		});
		
		//Send the signal to the receiver. 
		peer.on('signal', function(data)
		{
			socket.emit("signal", data);
		});
	});
	
	//When we receive the signal from socket.io, pass it to peer.
	socket.on("signal", function (data)
	{
    	peer.signal(data);
	});
}

/*
 _   _ _   _ _ _ _         
| | | | |_(_) (_) |_ _   _ 
| | | | __| | | | __| | | |
| |_| | |_| | | | |_| |_| |
 \___/ \__|_|_|_|\__|\__, |
   		 			 |___/ 
*/

/**
 * Shows the current page, and hides the others.
 * @param  {string} page Page name.
 */
function switchPage(page)
{
	$(".page").hide();

	$("#" + page + "Page").show();
}
