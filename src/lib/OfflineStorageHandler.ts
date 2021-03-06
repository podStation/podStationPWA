import Dexie from 'dexie';

// https://medium.com/@KevinBGreene/typescript-modeling-required-fields-with-mapped-types-f7bf17688786
type RequireOnly<T, K extends keyof T> = {
	[X in Exclude<keyof T, K>]?: T[X]
} & {
	[P in K]-?: T[P]
}

type RequireOnlyId<T extends {id?: number}> = RequireOnly<T, 'id'>;
export type RequireId<T extends {id?: number}> = Omit<T, 'id'> & {id: number};
type OmitId<T extends {id?: number}> = Omit<T, 'id'>;

export type Destination = {
	name: string,
	type?: string,
	address: string,
	split?: number
}

export type Value = {
	model: {
		type: string
		method?: string,
		suggested?: string,
	},
	destinations: Destination[]
}

export type Podcast = {
	id?: number,
	status: 'new' | 'processed',
	feedUrl: string,
	/**
	 * Stores known alternate feed URLs (i.e. after a permanent redirect)
	 */
	alternateFeedUrls?: string[],
	lastBuildDate?: Date,
	lastItemPubDate?: Date,
	firstItemPubDate?: Date,
	title?: string,
	description?: string,
	/**
	 * Podcast website
	 */
	link?: string,
	imageUrl?: string,
	subscribed: boolean,
	podcastIndexOrgId?: number,
	podcastIndexOrgLastEpisodeFetch?: Date,
	
	value?: Value[]
}

export type Episode = {
	// >>> feed and index data
	id?: number,
	podcastId: number, 
	title?: string,
	link?: string,
	description?: string,
	imageUrl?: string,
	categories?: [string],
	pubDate?: Date,
	enclosure?: {
		url: string,
		length: number,
		type: string,
	},
	duration?: number,
	guid?: string,
	podcastIndexOrgId: number
	// <<< feed and index data
	// >>> user data
	/**
	 * Last known listened position in seconds
	 */
	position?: number,
	lastTimeListened?: Date,
	finished?: boolean
	// <<< user data
}

class Database extends Dexie {
	podcasts: Dexie.Table<Podcast>;
	episodes: Dexie.Table<Episode>;

	constructor() {
		super('podStation');
 
		this.version(1).stores({
			podcasts: '++id, &feedUrl, *alternateFeedUrls, lastItemPubDate, firstItemPubDate',
			episodes: '++id, podcastId, link, *categories, pubDate, enclosure.url, guid, position',
		});

		this.podcasts = this.table('podcasts');
		this.episodes = this.table('episodes');
	}
}

export default interface OfflineStorageHandler {
	addPodcast(podcast: OmitId<Podcast>): Promise<number>;
	updatePodcast(podcast: RequireOnlyId<Podcast>): Promise<void>;
	deletePodcastById(podcastId: number): PromiseLike<void>;
	getPodcasts(): Promise<RequireId<Podcast>[]>;
	getPodcast(feedUrl: string): Promise<RequireId<Podcast> | undefined>;
	getPodcastById(id: number): Promise<RequireId<Podcast> | undefined>;
	putEpisodes(episodes: Episode[]): Promise<void>;
	updateEpisode(episode: RequireOnlyId<Episode>): Promise<void>;
	getEpisodes(podcastId: number): Promise<RequireId<Episode>[]>
	getAllEpisodes(count: number, asOfPubDate: Date): Promise<RequireId<Episode>[]>;
	getEpisodesInProgress(): Promise<RequireId<Episode>[]>;
	deleteDatabase(): Promise<void>;
}

export class OfflineStorageHandlerImplementation implements OfflineStorageHandler {
	private db = new Database();

	async addPodcast(podcast: Podcast): Promise<number> {
		return this.db.podcasts.add(podcast);
	}

	async updatePodcast(podcast: RequireOnlyId<Podcast>) {
		await this.db.podcasts.update(podcast.id, podcast);
	}

	async deletePodcastById(podcastId: number): Promise<void> {
		await this.db.episodes.where('podcastId').equals(podcastId).delete();
		await this.db.podcasts.delete(podcastId);
	}

	async getPodcasts(): Promise<RequireId<Podcast>[]> {
		return (await this.db.podcasts.toArray()) as RequireId<Podcast>[];
	}

	async getPodcast(feedUrl: string): Promise<RequireId<Podcast> | undefined> {
		let result = await this.db.podcasts.where('feedUrl').equals(feedUrl).first();

		return result ? result as RequireId<Podcast> : undefined;
	}

	async getPodcastById(id: number): Promise<RequireId<Podcast> | undefined> {
		let result = await this.db.podcasts.get(id);

		return result ? result as RequireId<Podcast> : undefined;
	}

	async putEpisodes(episodes: Episode[]) {
		return this.db.episodes.bulkPut(episodes);
	}

	async updateEpisode(episode: RequireOnlyId<Episode>): Promise<void> {
		await this.db.episodes.update(episode.id, episode);
	}

	async getEpisodes(podcastId: number): Promise<RequireId<Episode>[]> {
		return (await this.db.episodes.where('podcastId').equals(podcastId).reverse().sortBy('pubDate')) as RequireId<Episode>[];
	}

	async getAllEpisodes(count: number, asOfPubDate: Date): Promise<RequireId<Episode>[]> {
		return (await this.db.episodes.where('pubDate').belowOrEqual(asOfPubDate).reverse().limit(count).toArray()) as RequireId<Episode>[];
	}

	async getEpisodesInProgress(): Promise<RequireId<Episode>[]> {
		return (await this.db.episodes.where('position').aboveOrEqual(0).reverse().sortBy('lastTimeListened')) as RequireId<Episode>[];
	}

	async deleteDatabase(): Promise<void> {
		await this.db.delete();

		this.db = new Database();
	}
}