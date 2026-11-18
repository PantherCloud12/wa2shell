import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(80);
Config.setConcurrency(2);
Config.setChromiumOpenGlRenderer("angle");
Config.setChromiumMultiProcessOnLinux(true);
Config.setCodec("h264");
Config.setCrf(23);
Config.setX264Preset("ultrafast");
Config.setPixelFormat("yuv420p");
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(1);
